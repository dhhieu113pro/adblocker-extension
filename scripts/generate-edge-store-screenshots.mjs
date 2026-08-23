import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const WIDTH = 1280;
const HEIGHT = 800;
const inputDir = path.resolve(process.env.EDGE_STORE_INPUT_DIR || 'artifacts');
const outputDir = path.resolve(process.env.EDGE_STORE_OUTPUT_DIR || 'artifacts/edge-store');

const shots = [
  {
    input: 'popup-overview.png',
    output: '01-overview.png',
    eyebrow: 'OVERVIEW',
    title: 'Know what is being blocked.',
    description: 'See protection status, page context, and detected ads at a glance.',
  },
  {
    input: 'popup-settings.png',
    output: '02-settings.png',
    eyebrow: 'SETTINGS',
    title: 'Local AI, tuned for speed.',
    description: 'MobileNetV4 is the recommended default, with controls kept close at hand.',
  },
  {
    input: 'popup-history.png',
    output: '03-history.png',
    eyebrow: 'HISTORY',
    title: 'Review recent blocking activity.',
    description: 'Inspect what was blocked and clear the local history whenever you want.',
  },
];

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.subarray(1, 4).toString('ascii') !== 'PNG') {
    throw new Error('Generated file is not a valid PNG');
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });

  for (const shot of shots) {
    const sourcePath = path.join(inputDir, shot.input);
    const source = await readFile(sourcePath);
    const sourceDataUrl = `data:image/png;base64,${source.toString('base64')}`;

    await page.setContent(`<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=${WIDTH}, initial-scale=1" />
          <style>
            * { box-sizing: border-box; }
            html, body {
              width: ${WIDTH}px;
              height: ${HEIGHT}px;
              margin: 0;
              overflow: hidden;
              font-family: "Segoe UI Variable", "Segoe UI", Arial, sans-serif;
              background: #08111c;
              color: #f4f7fb;
            }
            body {
              display: grid;
              grid-template-columns: minmax(0, 1fr) 480px;
              gap: 72px;
              align-items: center;
              padding: 64px 84px;
              background:
                radial-gradient(circle at 18% 18%, rgba(50, 158, 232, 0.18), transparent 34%),
                linear-gradient(135deg, #08111c 0%, #0d1724 55%, #101c2a 100%);
            }
            .copy { max-width: 570px; }
            .brand {
              display: inline-flex;
              align-items: center;
              gap: 10px;
              margin-bottom: 54px;
              color: #b8c5d5;
              font-size: 20px;
              font-weight: 650;
            }
            .shield {
              display: grid;
              place-items: center;
              width: 38px;
              height: 38px;
              border: 1px solid #3a4d65;
              border-radius: 10px;
              background: #101823;
              color: #329ee8;
              font-size: 22px;
            }
            .eyebrow {
              margin-bottom: 18px;
              color: #69bdf3;
              font-size: 16px;
              font-weight: 750;
              letter-spacing: 0.14em;
            }
            h1 {
              max-width: 560px;
              margin: 0;
              font-size: 54px;
              line-height: 1.04;
              letter-spacing: -0.035em;
            }
            p {
              max-width: 540px;
              margin: 24px 0 0;
              color: #b8c5d5;
              font-size: 23px;
              line-height: 1.45;
            }
            .local {
              display: inline-flex;
              align-items: center;
              gap: 9px;
              margin-top: 38px;
              color: #8d9eb3;
              font-size: 16px;
            }
            .local-dot {
              width: 9px;
              height: 9px;
              border-radius: 50%;
              background: #38d39f;
            }
            .preview-wrap {
              display: grid;
              place-items: center;
              min-height: 660px;
            }
            .preview {
              width: 422px;
              padding: 15px;
              border: 1px solid #31445a;
              border-radius: 24px;
              background: rgba(16, 24, 35, 0.92);
              box-shadow: 0 28px 70px rgba(0, 0, 0, 0.38);
            }
            .preview img {
              display: block;
              width: 390px;
              max-height: 620px;
              object-fit: contain;
              object-position: top center;
              border-radius: 12px;
              background: #0a1018;
            }
          </style>
        </head>
        <body>
          <section class="copy">
            <div class="brand"><span class="shield">◇</span>AI Vision Ad Blocker</div>
            <div class="eyebrow">${escapeHtml(shot.eyebrow)}</div>
            <h1>${escapeHtml(shot.title)}</h1>
            <p>${escapeHtml(shot.description)}</p>
            <div class="local"><span class="local-dot"></span>Runs locally in your browser</div>
          </section>
          <section class="preview-wrap" aria-label="Extension popup preview">
            <div class="preview"><img alt="AI Vision Ad Blocker popup" src="${sourceDataUrl}" /></div>
          </section>
        </body>
      </html>`);

    await page.locator('img').waitFor({ state: 'visible' });
    await page.evaluate(() => document.fonts.ready);

    const outputPath = path.join(outputDir, shot.output);
    await page.screenshot({ path: outputPath, type: 'png', fullPage: false });

    const generated = await readFile(outputPath);
    const size = pngSize(generated);
    if (size.width !== WIDTH || size.height !== HEIGHT) {
      throw new Error(`${shot.output} is ${size.width}x${size.height}; expected ${WIDTH}x${HEIGHT}`);
    }

    console.log(`✓ ${shot.output} (${size.width}x${size.height})`);
  }
} finally {
  await browser.close();
}
