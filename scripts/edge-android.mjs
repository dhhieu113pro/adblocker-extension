import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceManifestPath = path.join(rootDir, 'src', 'manifest.json');
const androidManifestPath = path.join(rootDir, 'src', 'manifest.edge-android.json');

export function createEdgeAndroidManifest(manifest) {
  const permissions = Array.isArray(manifest.permissions)
    ? manifest.permissions.filter((permission) => permission !== 'contextMenus')
    : manifest.permissions;

  return {
    ...manifest,
    permissions,
    background: {
      ...manifest.background,
      service_worker: 'reporting-background-android.ts',
      type: 'module',
    },
  };
}

export function validateEdgeAndroidManifest(manifest) {
  if (manifest.manifest_version !== 3) throw new Error('Edge Android package must use Manifest V3');
  if (!manifest.version) throw new Error('Edge Android package must contain a version');
  if (manifest.permissions?.includes('contextMenus')) {
    throw new Error('Edge Android manifest must not request unsupported contextMenus permission');
  }
  if (manifest.background?.service_worker !== 'reporting-background-android.ts') {
    throw new Error('Edge Android manifest must use the Android-compatible background worker');
  }
  return manifest;
}

async function prepareManifest() {
  const source = JSON.parse(await readFile(sourceManifestPath, 'utf8'));
  const androidManifest = validateEdgeAndroidManifest(createEdgeAndroidManifest(source));
  await writeFile(androidManifestPath, `${JSON.stringify(androidManifest, null, 2)}\n`);
  console.log(`✓ Edge Android manifest prepared: ${path.relative(rootDir, androidManifestPath)}`);
}

async function packageCrx() {
  const keyPath = process.env.EDGE_ANDROID_CRX_KEY_PATH;
  const outputPath = process.env.EDGE_ANDROID_CRX_OUTPUT;
  if (!keyPath) throw new Error('EDGE_ANDROID_CRX_KEY_PATH is required');
  if (!outputPath) throw new Error('EDGE_ANDROID_CRX_OUTPUT is required');

  const distDir = path.join(rootDir, 'dist-edge-android');
  const builtManifest = JSON.parse(await readFile(path.join(distDir, 'manifest.json'), 'utf8'));
  if (builtManifest.permissions?.includes('contextMenus')) {
    throw new Error('Built Edge Android manifest still contains contextMenus');
  }
  if (!builtManifest.version) throw new Error('Built Edge Android manifest has no version');

  await mkdir(path.dirname(outputPath), { recursive: true });
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(npx, [
    '--yes',
    'crx3@2.0.0',
    '--forceDateTime', '0',
    '-p', keyPath,
    '-o', outputPath,
    '--', distDir,
  ], { cwd: rootDir, stdio: 'inherit' });

  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`crx3 failed with exit code ${result.status}`);
  console.log(`✓ Edge Android CRX created: ${outputPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === 'prepare') await prepareManifest();
  else if (command === 'package') await packageCrx();
  else throw new Error(`Unknown command: ${command || '<missing>'}`);
}
