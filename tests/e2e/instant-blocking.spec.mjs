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
  const findWorker = () => ctx.serviceWorkers().find((item) =>
    item.url().startsWith('chrome-extension://') && item.url().includes('reporting-background')
  );

  let found = findWorker();
  if (!found) {
    const created = await ctx.waitForEvent('serviceworker');
    if (created.url().startsWith('chrome-extension://') && created.url().includes('reporting-background')) {
      found = created;
    } else {
      found = findWorker();
    }
  }

  if (!found) throw new Error('Extension reporting-background service worker did not start');
  return found;
}

async function withExtensionWorker(callback, arg) {
  worker = await waitForExtensionServiceWorker(context);
  return worker.evaluate(callback, arg);
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
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><rect width="500" height="500" fill="#ddd"/></svg>');
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
        <img id="cached-ad" width="500" height="500" src="${baseUrl}/ads/creative.svg" />
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
  await withExtensionWorker(async () => {
    await chrome.storage.sync.set({ autoHideAds: true, disabledSites: [], visionModel: 'clip' });
    await chrome.storage.local.remove('webllmClipCache');
  });
});

test('previously classified explicit ads are hidden from persisted cache without refetching pixels', async () => {
  const imageUrl = `${baseUrl}/ads/creative.svg`;
  await withExtensionWorker(async ({ imageUrl }) => {
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
