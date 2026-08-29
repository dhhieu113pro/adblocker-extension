import { test, expect, chromium } from '@playwright/test';
import path from 'node:path';
import http from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';

let context;
let extensionId;
let popupPath;
let extensionVersion;
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
  extensionVersion = manifest.version;
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
  if (server) await new Promise((resolve) => server.close(resolve));
});

function popupUrl() {
  return `chrome-extension://${extensionId}/${popupPath}`;
}

async function assertScreenshotCreated(filePath) {
  const file = await stat(filePath);
  expect(file.size).toBeGreaterThan(0);
}

async function openPopup() {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 390, height: 650 });
  await popup.goto(popupUrl());
  return popup;
}

const FULL_SITE_ORIGINS = ['http://*/*', 'https://*/*'];
const FULL_PROTECTION_SCRIPT_IDS = ['ai-vision-content', 'ai-vision-main'];

test('keeps browser action width fixed when the initial viewport is narrow', async () => {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 80, height: 650 });
  await popup.goto(popupUrl());

  await expect.poll(async () => popup.evaluate(() => Math.round(document.body.getBoundingClientRect().width))).toBe(390);
});

test('fresh install starts with full protection automatically enabled', async () => {
  const popup = await openPopup();

  await expect.poll(async () => popup.evaluate(async (origins) => chrome.permissions.contains({ origins }), FULL_SITE_ORIGINS)).toBe(true);
  await expect(popup.locator('#status-label')).toHaveText('Protection is on');
  await expect(popup.getByRole('button', { name: 'Enable full protection' })).toBeHidden();
  await expect(popup.locator('#site-block-toggle')).toBeEnabled();
});

test('opens Overview by default and captures every popup tab', async () => {
  expect(extensionId).toBeTruthy();
  expect(popupPath).toBeTruthy();
  expect(extensionVersion).toBeTruthy();

  const popup = await openPopup();
  await expect(popup.getByText('AI Vision Ad Blocker')).toBeVisible();
  await expect(popup.locator('#version-label')).toHaveText(`v${extensionVersion}`);

  const overviewTab = popup.getByRole('tab', { name: 'Overview' });
  const settingsTab = popup.getByRole('tab', { name: 'Settings' });
  const historyTab = popup.getByRole('tab', { name: 'History' });

  await expect(overviewTab).toHaveAttribute('aria-selected', 'true');
  await expect(popup.locator('#panel-overview')).toBeVisible();
  await expect(popup.locator('#panel-settings')).toBeHidden();
  await expect(popup.locator('#panel-history')).toBeHidden();

  const overviewScreenshot = path.join(screenshotDir, 'popup-overview.png');
  await popup.screenshot({ path: overviewScreenshot, fullPage: true });
  await assertScreenshotCreated(overviewScreenshot);

  await settingsTab.click();
  await expect(settingsTab).toHaveAttribute('aria-selected', 'true');
  await expect(popup.locator('#panel-settings')).toBeVisible();
  const settingsScreenshot = path.join(screenshotDir, 'popup-settings.png');
  await popup.screenshot({ path: settingsScreenshot, fullPage: true });
  await assertScreenshotCreated(settingsScreenshot);

  await historyTab.click();
  await expect(historyTab).toHaveAttribute('aria-selected', 'true');
  await expect(popup.locator('#panel-history')).toBeVisible();
  const historyScreenshot = path.join(screenshotDir, 'popup-history.png');
  await popup.screenshot({ path: historyScreenshot, fullPage: true });
  await assertScreenshotCreated(historyScreenshot);
});

test('supports keyboard navigation across popup tabs', async () => {
  const popup = await openPopup();
  const overviewTab = popup.getByRole('tab', { name: 'Overview' });
  const settingsTab = popup.getByRole('tab', { name: 'Settings' });
  const historyTab = popup.getByRole('tab', { name: 'History' });

  await overviewTab.focus();
  await popup.keyboard.press('ArrowRight');
  await expect(settingsTab).toHaveAttribute('aria-selected', 'true');
  await expect(settingsTab).toBeFocused();

  await popup.keyboard.press('ArrowRight');
  await expect(historyTab).toHaveAttribute('aria-selected', 'true');
  await expect(historyTab).toBeFocused();

  await popup.keyboard.press('Home');
  await expect(overviewTab).toHaveAttribute('aria-selected', 'true');
  await expect(overviewTab).toBeFocused();
});

test('keeps the legacy mobilenet preference as the default fast classifier key', async () => {
  const popup = await openPopup();

  await popup.evaluate(() => new Promise((resolve) => chrome.storage.sync.remove('visionModel', resolve)));
  await popup.reload();
  await popup.getByRole('tab', { name: 'Settings' }).click();

  await expect(popup.locator('#vision-model-select')).toHaveValue('mobilenet');
});

test('labels the fast local classifier as the recommended vision model', async () => {
  const popup = await openPopup();
  await popup.getByRole('tab', { name: 'Settings' }).click();

  await expect(popup.locator('#vision-model-select option[value="mobilenet"]')).toHaveText('Fast Local Classifier · Recommended');
  await expect(popup.locator('#vision-model-select option[value="clip"]')).toHaveText('CLIP Vision');
});

test('persists popup protection settings through chrome.storage', async () => {
  const popup = await openPopup();
  await popup.getByRole('tab', { name: 'Settings' }).click();

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

test('renders and clears blocked history from the History tab', async () => {
  const popup = await openPopup();
  await popup.evaluate(() => chrome.storage.local.set({
    adBlockHistory: [{
      url: 'https://ads.example.com/banner',
      domain: 'ads.example.com',
      pageUrl: 'https://movie.example/watch',
      timestamp: Date.now(),
      count: 3,
    }],
  }));
  await popup.reload();
  await popup.getByRole('tab', { name: 'History' }).click();

  await expect(popup.locator('#history-list')).toContainText('ads.example.com');
  await expect(popup.locator('#history-list')).toContainText('blocked 3×');

  await popup.locator('#clear-history-btn').click();
  await expect(popup.locator('#history-list')).toContainText('No blocked history yet');
  await expect.poll(async () => popup.evaluate(async () => {
    const value = await chrome.storage.local.get('adBlockHistory');
    return value.adBlockHistory;
  })).toEqual([]);
});

test('fresh install automatically runs DOM protection on pages', async () => {
  const page = await context.newPage();
  await page.goto(baseUrl);

  await expect(page.locator('#normal-content')).toBeVisible();
  await expect.poll(async () => page.locator('#adbro').evaluate((el) => ({
    hidden: el.dataset.webllmAdHidden,
    display: getComputedStyle(el).display,
  }))).toEqual({ hidden: 'true', display: 'none' });

  await page.close();
});

test('required full-site access registers the protection scripts automatically', async () => {
  const popup = await openPopup();

  await expect.poll(async () => popup.evaluate(async (origins) => chrome.permissions.contains({ origins }), FULL_SITE_ORIGINS)).toBe(true);
  await expect.poll(async () => popup.evaluate(async (ids) => {
    const registrations = await chrome.scripting.getRegisteredContentScripts({ ids });
    return registrations.map((item) => item.id).sort();
  }, FULL_PROTECTION_SCRIPT_IDS)).toEqual([...FULL_PROTECTION_SCRIPT_IDS].sort());

  const protectedPage = await context.newPage();
  await protectedPage.goto(baseUrl);
  await expect(protectedPage.locator('#normal-content')).toBeVisible();
  await expect.poll(async () => protectedPage.locator('#adbro').evaluate((el) => ({
    hidden: el.dataset.webllmAdHidden,
    display: getComputedStyle(el).display,
  }))).toEqual({ hidden: 'true', display: 'none' });

  await expect(popup.getByRole('button', { name: 'Enable full protection' })).toBeHidden();
  await expect(popup.locator('#status-label')).toHaveText('Protection is on');

  await protectedPage.close();
  await popup.close();
});

test('whole-page CLIP classification is gated behind explicit CLIP selection', async () => {
  const background = await readFile(path.resolve('src/background.ts'), 'utf8');
  const section = background.slice(background.indexOf('// 3. AI Visually Classify Website Category on Load Completed & Block Ad Popups'));
  const modelRead = section.indexOf('chrome.storage.sync.get("visionModel")');
  const clipGuard = section.indexOf('selectedModel !== "clip"');
  const capture = section.indexOf('chrome.tabs.captureVisibleTab');

  expect(modelRead).toBeGreaterThanOrEqual(0);
  expect(clipGuard).toBeGreaterThan(modelRead);
  expect(capture).toBeGreaterThan(clipGuard);
});

test('offscreen uses valid Transformers.js model repositories and a compatible fast classifier', async () => {
  const offscreen = await readFile(path.resolve('src/offscreen.ts'), 'utf8');

  expect(offscreen).toContain('"Xenova/clip-vit-base-patch16"');
  expect(offscreen).not.toContain('"Xenova/clip-vit-base-patch16-224"');
  expect(offscreen).toContain('"Xenova/dit-base-finetuned-rvlcdip"');
  expect(offscreen).not.toContain('mobilenetv4_conv_small');
  expect(offscreen).not.toContain('mobilenet_v4');
  expect(offscreen).toContain('const selectedModel = message.model === "clip" ? "clip" : "mobilenet";');
});

test('fast local image results are labelled accurately instead of as MobileNet', async () => {
  const background = await readFile(path.resolve('src/background.ts'), 'utf8');

  expect(background).toContain('Fast Local Classifier + Heuristics');
  expect(background).not.toContain('MobileNetV4 Image Classification + Heuristics');
});
