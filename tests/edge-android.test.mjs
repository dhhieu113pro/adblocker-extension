import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createEdgeAndroidManifest, validateEdgeAndroidManifest } from '../scripts/edge-android.mjs';

test('Edge Android manifest removes desktop-only contextMenus permission', () => {
  const manifest = createEdgeAndroidManifest({
    manifest_version: 3,
    name: 'AI Vision Ad Blocker',
    version: '1.2.3',
    permissions: ['storage', 'contextMenus', 'declarativeNetRequest'],
  });

  assert.deepEqual(manifest.permissions, ['storage', 'declarativeNetRequest']);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '1.2.3');
});

test('Edge Android manifest validation rejects contextMenus', () => {
  assert.throws(
    () => validateEdgeAndroidManifest({ manifest_version: 3, version: '1.2.3', permissions: ['contextMenus'] }),
    /contextMenus/,
  );
});

test('package scripts expose Android build and CRX packaging commands', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(typeof pkg.scripts['build:edge-android'], 'string');
  assert.equal(typeof pkg.scripts['package:edge-android:crx'], 'string');
});

test('release workflow publishes an Edge Android CRX and requires signing key', async () => {
  const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /EDGE_ANDROID_CRX_PRIVATE_KEY/);
  assert.match(workflow, /\.crx/);
  assert.match(workflow, /build:edge-android/);
});
