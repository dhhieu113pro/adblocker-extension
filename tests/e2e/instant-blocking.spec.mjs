import { test, expect, chromium } from '@playwright/test';
import path from 'node:path';
import http from 'node:http';

let context;
let worker;
let server;
let baseUrl;
const requestCounts = new Map();

function count(pathname) {
  requestCounts.set(pathname, (requestCounts.get(pathname) || 0) + 1);
}

async function waitForExtensionServiceWorker(ctx) {
  let workers = ctx.serviceWorkers();
  if (workers.length === 0) {
    await ctx.waitForEvent('serviceworker');
    workers = ctx.serviceWorkers();
  }
  const found = workers.find((item) => item.url().startsWith('chrome-extension://'));
  if (!found) throw new Error('Extension service worker did not start');
  return found;
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
  worker = await waitForExtensionServiceWorker(context);

  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    count(url.pathname);

    if (url.pathname === '/ads/creative.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="200"><rect width="1000" height="200" fill="#ddd"/></svg>');
      return;
    }

    if (url.pathname.endsWith('.gif')) {
      res.writeHead(200, { 'content-type': 'image/gif', 'cache-control': 'no-store' });
      res.end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'));
      return;
    }

    if (url.pathname === '/cached-page') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><body>
        <img id="cached-ad" width="1000" height="200" src="${baseUrl}/ads/creative.svg" />
      </body></html>`);
      return;
    }

    if (url.pathname === '/heuristic-page') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><body>
        <img id="heuristic-ad" width="728" height="90" src="${baseUrl}/banner-ad.gif" />
      </body></html>`);
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async () => {
  await context?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test.beforeEach(async () => {
  requestCounts.clear();
  await worker.evaluate(async () => {
    await chrome.storage.sync.set({ autoHideAds: true, disabledSites: [], visionModel: 'clip' });
    await chrome.storage.local.remove('webllmClipCache');
  });
});

test('previously classified explicit ads are hidden from persisted cache without refetching pixels', async () => {
  const imageUrl = `${baseUrl}/ads/creative.svg`;
  await worker.evaluate(async ({ imageUrl }) => {
    await chrome.storage.local.set({
      webllmClipCache: {
        [imageUrl]: {
          label: 'advertisement',
          score: 0.98,
          aiConfidence: 98,
          isAd: true,
          ts: Date.now(),
        },
      },
    });
  }, { imageUrl });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/cached-page`);

  await expect.poll(async () => page.locator('#cached-ad').evaluate((el) => ({
    hidden: el.closest('[data-webllm-ad-hidden="true"]') !== null,
    display: getComputedStyle(el).display,
  })), { timeout: 1000 }).toEqual({ hidden: true, display: 'none' });

  expect(requestCounts.get('/ads/creative.svg')).toBe(1);
  await page.close();
});

test('strong heuristic ads are hidden from HTML dimensions without an extension-side pixel refetch', async () => {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/heuristic-page`);

  await expect.poll(async () => page.locator('#heuristic-ad').evaluate((el) => ({
    hidden: el.closest('[data-webllm-ad-hidden="true"]') !== null,
    display: getComputedStyle(el).display,
  })), { timeout: 1000 }).toEqual({ hidden: true, display: 'none' });

  expect(requestCounts.get('/banner-ad.gif')).toBe(1);
  await page.close();
});
