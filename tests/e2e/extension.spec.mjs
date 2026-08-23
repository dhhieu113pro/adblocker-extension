import { test, expect, chromium } from '@playwright/test';
import path from 'node:path';
import http from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';

let context;
let extensionId;
let popupPath;
let server;
let baseUrl;
const screenshotDir = path.resolve('artifacts');

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

test.beforeAll(async () => {
  await mkdir(screenshotDir, { recursive: true });

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

  server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
      <html>
        <body>
          <main id="normal-content">Normal page content</main>
          <div id="adbro">
            <img id="known-ad" alt="ad" width="300" height="250"
              src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" />
          </div>
        </body>
      </html>`);
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await context?.close();
  await new Promise((resolve) => server?.close(() => resolve()));
});

function popupUrl() {
  return `chrome-extension://${extensionId}/${popupPath}`;
}

async function assertScreenshotCreated(filePath) {
  const file = await stat(filePath);
  expect(file.size).toBeGreaterThan(0);
}

test('loads the built MV3 extension and captures popup screenshots', async () => {
  expect(extensionId).toBeTruthy();
  expect(popupPath).toBeTruthy();

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 390, height: 650 });
  await popup.goto(popupUrl());

  await expect(popup.getByText('AI Vision Ad Blocker')).toBeVisible();
  await expect(popup.locator('#status-label')).toContainText('Protection');
  await expect(popup.locator('#site-block-toggle')).toBeAttached();
  await expect(popup.locator('#auto-hide-toggle')).toBeAttached();

  const popupScreenshot = path.join(screenshotDir, 'popup.png');
  await popup.screenshot({ path: popupScreenshot, fullPage: true });
  await assertScreenshotCreated(popupScreenshot);

  const settingsPanel = popup.locator('#advanced-panel');
  await settingsPanel.locator('summary').click();
  await expect(settingsPanel).toHaveAttribute('open', '');

  const settingsScreenshot = path.join(screenshotDir, 'popup-settings.png');
  await popup.screenshot({ path: settingsScreenshot, fullPage: true });
  await assertScreenshotCreated(settingsScreenshot);
});

test('persists popup protection settings through chrome.storage', async () => {
  const popup = await context.newPage();
  await popup.goto(popupUrl());

  const settingsPanel = popup.locator('#advanced-panel');
  await settingsPanel.locator('summary').click();
  await expect(settingsPanel).toHaveAttribute('open', '');

  const autoHide = popup.locator('#auto-hide-toggle');
  const autoHideSlider = autoHide.locator('xpath=following-sibling::*[contains(@class,"toggle-slider")]');

  if (await autoHide.isChecked()) {
    await autoHideSlider.click();
  }

  await expect.poll(async () => popup.evaluate(async () => {
    const value = await chrome.storage.sync.get('autoHideAds');
    return value.autoHideAds;
  })).toBe(false);

  await autoHideSlider.click();
  await expect.poll(async () => popup.evaluate(async () => {
    const value = await chrome.storage.sync.get('autoHideAds');
    return value.autoHideAds;
  })).toBe(true);
});

test('content script hides a known ad container on a real HTTP page', async () => {
  const page = await context.newPage();
  await page.goto(baseUrl);

  await expect(page.locator('#normal-content')).toBeVisible();
  await expect.poll(async () => page.locator('#adbro').evaluate((el) => ({
    hidden: el.dataset.webllmAdHidden,
    display: getComputedStyle(el).display,
  }))).toEqual({ hidden: 'true', display: 'none' });
});
