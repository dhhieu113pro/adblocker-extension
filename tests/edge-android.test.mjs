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

test('package scripts build Android through a real manifest.json and expose CRX packaging', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const build = pkg.scripts['build:edge-android'];
  assert.equal(typeof build, 'string');
  assert.match(build, /edge-android\.mjs build-manifest/);
  assert.doesNotMatch(build, /manifest\.edge-android\.json/);
  assert.equal(typeof pkg.scripts['package:edge-android:crx'], 'string');
});

test('Android manifest helper restores the desktop manifest after the temporary build swap', async () => {
  const source = await readFile(new URL('../scripts/edge-android.mjs', import.meta.url), 'utf8');
  assert.match(source, /finally\s*\{/);
  assert.match(source, /writeFile\(sourceManifestPath, originalManifestText\)/);
  assert.match(source, /dist-edge-android\/manifest\.json/);
});

test('Android background stays statically bundleable while shimming unsupported context menus first', async () => {
  const worker = await readFile(new URL('../src/reporting-background-android.ts', import.meta.url), 'utf8');
  const shim = await readFile(new URL('../src/android-context-menus-shim.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(worker, /import\s*\(/);
  assert.match(worker, /import '\.\/android-context-menus-shim';\s*import '\.\/reporting-background';/s);
  assert.match(shim, /if \(!chromeApi\.contextMenus\)/);
});

test('release workflow publishes an Edge Android CRX and requires signing key', async () => {
  const workflow = await readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /EDGE_ANDROID_CRX_PRIVATE_KEY/);
  assert.match(workflow, /\.crx/);
  assert.match(workflow, /build:edge-android/);
});
