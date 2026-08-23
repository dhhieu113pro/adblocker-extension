import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlO5i8AAAAASUVORK5CYII=',
  'base64'
);

function readPngSize(buffer) {
  expect(buffer.subarray(1, 4).toString('ascii')).toBe('PNG');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

test('generates three Microsoft Edge Store PNGs at 1280x800', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'edge-store-screenshots-'));
  const inputDir = path.join(root, 'input');
  const outputDir = path.join(root, 'output');
  await mkdir(inputDir, { recursive: true });

  for (const name of ['popup-overview.png', 'popup-settings.png', 'popup-history.png']) {
    await writeFile(path.join(inputDir, name), ONE_PIXEL_PNG);
  }

  const result = spawnSync(process.execPath, ['scripts/generate-edge-store-screenshots.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      EDGE_STORE_INPUT_DIR: inputDir,
      EDGE_STORE_OUTPUT_DIR: outputDir,
    },
  });

  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);

  for (const name of ['01-overview.png', '02-settings.png', '03-history.png']) {
    const png = await readFile(path.join(outputDir, name));
    expect(readPngSize(png)).toEqual({ width: 1280, height: 800 });
    expect(png.byteLength).toBeGreaterThan(1000);
  }

  await rm(root, { recursive: true, force: true });
});
