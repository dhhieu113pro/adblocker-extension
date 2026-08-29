import { test, expect, chromium } from '@playwright/test';
import path from 'node:path';

let context;
let extensionId;

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

async function openReport() {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/report.html`);
  return page;
}

test.beforeAll(async () => {
  const extensionPath = path.resolve('dist');
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
});

test.afterAll(async () => {
  await context?.close();
});

test.beforeEach(async () => {
  const page = await openReport();
  await page.evaluate(() => chrome.storage.local.remove(['reportEventsV1', 'reportDailyV1', 'reportCategoryCacheV1']));
  await page.close();
});

test('renders a locally recorded popup without leaking URL path or query', async () => {
  const page = await openReport();
  await page.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: 'protectionBlocked',
      pageUrl: 'https://news.example/private/article?q=secret',
      blockedTargetUrl: 'https://blocked.example/private?token=hidden',
      blockType: 'popup',
      detectionMethod: 'network',
      resourceType: 'popup',
      pageMetadata: 'news articles headlines',
    });
  });
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Protection Report' })).toBeVisible();
  await expect(page.getByText('Stays on this device')).toBeVisible();
  await expect(page.locator('#kpi-popups')).toHaveText('1');
  await expect(page.locator('#kpi-sites')).toHaveText('1');
  await expect(page.locator('#recent')).toContainText('news.example');
  await expect(page.locator('#recent')).toContainText('blocked.example');
  await expect(page.locator('body')).not.toContainText('secret');
  await expect(page.locator('body')).not.toContainText('hidden');

  await page.close();
});

test('changes ranges and clears report statistics without changing protection settings', async () => {
  const page = await openReport();
  await page.evaluate(async () => {
    await chrome.storage.sync.set({ autoHideAds: true });
    await chrome.runtime.sendMessage({
      type: 'protectionBlocked',
      pageUrl: 'https://shop.example/checkout',
      blockedTargetUrl: 'https://popup.example/ad',
      blockType: 'popup',
      detectionMethod: 'heuristic',
      resourceType: 'popup',
    });
  });
  await page.reload();
  await expect(page.locator('#kpi-popups')).toHaveText('1');

  await page.getByRole('button', { name: 'Today' }).click();
  await expect(page.locator('#kpi-popups')).toHaveText('1');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Clear Statistics' }).click();
  await expect(page.locator('#kpi-popups')).toHaveText('0');
  await expect.poll(async () => page.evaluate(async () => (await chrome.storage.sync.get('autoHideAds')).autoHideAds)).toBe(true);

  await page.close();
});
