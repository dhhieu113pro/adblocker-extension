import { test, expect, chromium } from '@playwright/test';
import path from 'node:path';
import http from 'node:http';

let context;
let server;
let baseUrl;

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
  const extensionPath = path.resolve('dist');
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  await waitForExtensionServiceWorker(context);

  await context.route('https://i.ytimg.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/gif',
      body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
    });
  });

  server = http.createServer((req, res) => {
    if (req.url === '/editorial.gif') {
      res.writeHead(200, { 'content-type': 'image/gif' });
      res.end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'));
      return;
    }

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
      <html>
        <body>
          <a href="https://www.youtube.com/watch?v=abc123">
            <img id="youtube-thumb" width="336" height="188"
              src="https://i.ytimg.com/vi/abc123/hq720.jpg?sqp=qcA9&rs=AOn4CLDadsXYZ"
              alt="Video thumbnail" />
          </a>
          <article>
            <img id="editorial-image" width="300" height="250"
              src="${baseUrl || ''}/editorial.gif"
              alt="Article photo" />
          </article>
        </body>
      </html>`);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await context?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('normal YouTube thumbnails and IAB-sized editorial images stay visible', async () => {
  const page = await context.newPage();
  await page.goto(baseUrl);

  await expect(page.locator('#youtube-thumb')).toBeVisible();
  await expect(page.locator('#editorial-image')).toBeVisible();

  await page.waitForTimeout(1500);

  for (const selector of ['#youtube-thumb', '#editorial-image']) {
    await expect.poll(async () => page.locator(selector).evaluate((img) => ({
      hidden: img.dataset.webllmAdHidden || '',
      display: getComputedStyle(img).display,
      visibility: getComputedStyle(img).visibility,
    }))).toEqual({ hidden: '', display: 'inline', visibility: 'visible' });
  }

  await page.close();
});
