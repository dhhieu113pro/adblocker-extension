import { test, expect, chromium } from '@playwright/test';
import path from 'node:path';
import http from 'node:http';
import { readFile } from 'node:fs/promises';

let context;
let extensionId;
let popupPath;
let server;
let baseUrl;
let localhostUrl;

async function waitForExtensionServiceWorker(ctx) {
  let workers = ctx.serviceWorkers();
  if (workers.length === 0) {
    await ctx.waitForEvent('serviceworker');
    workers = ctx.serviceWorkers();
  }
  const worker = workers.find((item) => item.url().startsWith('chrome-extension://'));
  if (!worker) throw new Error('Extension service worker did not start');
  return worker;
}

function popupUrl() {
  return `chrome-extension://${extensionId}/${popupPath}`;
}

async function openPopup() {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 390, height: 650 });
  await popup.goto(popupUrl());
  return popup;
}

const FULL_SITE_ORIGINS = ['http://*/*', 'https://*/*'];

async function primeFullSiteAccessForHeadlessTest() {
  const manager = await context.newPage();
  try {
    await manager.goto(`chrome://extensions/?id=${extensionId}`);
    await manager.waitForFunction(() => Boolean(chrome.developerPrivate?.addHostPermission));
    await manager.evaluate(async ({ id, origins }) => {
      for (const origin of origins) {
        await chrome.developerPrivate.addHostPermission(id, origin);
      }
    }, { id: extensionId, origins: FULL_SITE_ORIGINS });
  } finally {
    await manager.close();
  }
}

async function grantFullSiteAccess(popup) {
  await primeFullSiteAccessForHeadlessTest();
  await popup.getByRole('button', { name: 'Enable full protection' }).click();
  await expect.poll(async () => popup.evaluate(async (origins) => chrome.permissions.contains({ origins }), FULL_SITE_ORIGINS)).toBe(true);
}

async function ensureFullSiteAccess(popup) {
  const alreadyGranted = await popup.evaluate(async (origins) => chrome.permissions.contains({ origins }), FULL_SITE_ORIGINS);
  if (!alreadyGranted) await grantFullSiteAccess(popup);
}

async function readDynamicRules(popup) {
  return popup.evaluate(async () => chrome.declarativeNetRequest.getDynamicRules());
}

async function readHiddenState(page) {
  return page.locator('#adbro').evaluate((el) => ({
    hidden: el.dataset.webllmAdHidden,
    display: getComputedStyle(el).display,
  }));
}

test.beforeAll(async () => {
  const extensionPath = path.resolve('dist');
  const manifest = JSON.parse(await readFile(path.join(extensionPath, 'manifest.json'), 'utf8'));
  popupPath = manifest.action?.default_popup;
  if (!popupPath) throw new Error('Built manifest does not define action.default_popup');

  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const worker = await waitForExtensionServiceWorker(context);
  extensionId = new URL(worker.url()).host;

  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body>
      <main id="normal-content">Normal page content</main>
      <div id="adbro"><img alt="ad" width="300" height="250" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" /></div>
    </body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  localhostUrl = `http://localhost:${address.port}`;
});

test.afterAll(async () => {
  await context?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('global protection off immediately restores the page and removes all DNR blocking rules', async () => {
  const popup = await openPopup();
  await popup.evaluate(() => chrome.storage.sync.set({ autoHideAds: true, disabledSites: [] }));
  await popup.reload();
  await ensureFullSiteAccess(popup);

  const page = await context.newPage();
  await page.goto(baseUrl);
  await expect.poll(async () => readHiddenState(page)).toEqual({ hidden: 'true', display: 'none' });

  await expect.poll(async () => (await readDynamicRules(popup)).length).toBeGreaterThan(0);

  await popup.getByRole('tab', { name: 'Settings' }).click();
  const autoHide = popup.locator('#auto-hide-toggle');
  const autoHideSlider = autoHide.locator('xpath=following-sibling::*[contains(@class,"toggle-slider")]');
  if (await autoHide.isChecked()) await autoHideSlider.click();

  await expect.poll(async () => popup.evaluate(async () => (await chrome.storage.sync.get('autoHideAds')).autoHideAds)).toBe(false);
  await expect.poll(async () => (await readDynamicRules(popup)).length).toBe(0);
  await expect.poll(async () => readHiddenState(page)).toEqual({ hidden: undefined, display: 'block' });

  await autoHideSlider.click();
  await expect.poll(async () => popup.evaluate(async () => (await chrome.storage.sync.get('autoHideAds')).autoHideAds)).toBe(true);
  await expect.poll(async () => (await readDynamicRules(popup)).length).toBeGreaterThan(0);
  await expect.poll(async () => readHiddenState(page)).toEqual({ hidden: 'true', display: 'none' });

  await page.close();
  await popup.close();
});

test('per-site protection off bypasses only that site and keeps permission granted', async () => {
  const popup = await openPopup();
  await popup.evaluate(() => chrome.storage.sync.set({ autoHideAds: true, disabledSites: [] }));
  await popup.reload();
  await ensureFullSiteAccess(popup);

  const allowedPage = await context.newPage();
  await allowedPage.goto(localhostUrl);
  await expect.poll(async () => readHiddenState(allowedPage)).toEqual({ hidden: 'true', display: 'none' });

  await allowedPage.bringToFront();
  await popup.reload();
  await expect(popup.locator('#current-site')).toHaveText('localhost');
  const siteToggle = popup.locator('#site-block-toggle');
  const siteSlider = siteToggle.locator('xpath=following-sibling::*[contains(@class,"toggle-slider")]');
  await expect(siteToggle).toBeChecked();
  await siteSlider.click();

  await expect.poll(async () => popup.evaluate(async () => (await chrome.storage.sync.get('disabledSites')).disabledSites)).toContain('localhost');
  await expect.poll(async () => readHiddenState(allowedPage)).toEqual({ hidden: undefined, display: 'block' });
  await expect.poll(async () => {
    const rules = await readDynamicRules(popup);
    return rules.length > 0 && rules.every((rule) => rule.condition.excludedInitiatorDomains?.includes('localhost'));
  }).toBe(true);

  const protectedPage = await context.newPage();
  await protectedPage.goto(baseUrl);
  await expect.poll(async () => readHiddenState(protectedPage)).toEqual({ hidden: 'true', display: 'none' });
  await expect.poll(async () => popup.evaluate(async (origins) => chrome.permissions.contains({ origins }), FULL_SITE_ORIGINS)).toBe(true);

  await siteSlider.click();
  await expect.poll(async () => popup.evaluate(async () => (await chrome.storage.sync.get('disabledSites')).disabledSites || [])).not.toContain('localhost');
  await expect.poll(async () => {
    const rules = await readDynamicRules(popup);
    return rules.length > 0 && rules.every((rule) => !(rule.condition.excludedInitiatorDomains || []).includes('localhost'));
  }).toBe(true);
  await expect.poll(async () => readHiddenState(allowedPage)).toEqual({ hidden: 'true', display: 'none' });

  await protectedPage.close();
  await allowedPage.close();
  await popup.close();
});
