import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(testDir, "..");

function readText(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

test("Chrome Store manifest makes broad browsing access optional", () => {
  const manifest = readJson("src/manifest.json");

  assert.equal(manifest.permissions.includes("activeTab"), false);
  assert.equal(manifest.permissions.includes("tabs"), false);
  assert.deepEqual(manifest.host_permissions, ["https://raw.githubusercontent.com/*"]);
  assert.deepEqual(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]);
  assert.equal("content_scripts" in manifest, false);
  assert.equal("web_accessible_resources" in manifest, false);
  assert.equal(manifest.version, "1.0.12");
  assert.equal(
    manifest.content_security_policy?.extension_pages,
    "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
  );
});

test("Chrome Store build packages stable runtime scripts and internal offscreen AI", () => {
  const packageJson = readJson("package.json");
  const packageLock = readJson("package-lock.json");
  const copyScript = readText("scripts/copy-wasm.js");

  assert.match(packageJson.scripts["build:offscreen"] || "", /parcel build src\/offscreen\.html/);
  assert.match(packageJson.scripts["build:runtime"] || "", /parcel build src\/content\.js src\/inject\.ts/);
  assert.match(packageJson.scripts.build, /npm run build:offscreen/);
  assert.match(packageJson.scripts.build, /npm run build:runtime/);
  assert.match(copyScript, /offscreen\.html/);
  assert.match(copyScript, /runtime\/content\.js|runtime["'],\s*["']content\.js/);
  assert.match(copyScript, /runtime\/inject\.js|runtime["'],\s*["']inject\.js/);
  assert.equal(packageJson.version, "1.0.12");
  assert.equal(packageLock.version, "1.0.12");
  assert.equal(packageLock.packages?.[""]?.version, "1.0.12");
});

test("background synchronizes optional access and runtime scripts are injection-safe", () => {
  const background = readText("src/background.ts");
  const content = readText("src/content.js");
  const inject = readText("src/inject.ts");

  assert.match(background, /syncFullProtectionRegistration/);
  assert.match(background, /chrome\.permissions\.onAdded/);
  assert.match(background, /chrome\.permissions\.onRemoved/);
  assert.match(background, /chrome\.scripting\.executeScript/);
  assert.match(background, /runtime\/inject\.js/);
  assert.match(background, /runtime\/content\.js/);
  assert.match(background, /activateFullProtectionOnTab/);
  assert.match(background, /fullProtectionDisabled/);
  assert.match(content, /__aiVisionAdBlockerContentInitialized/);
  assert.match(content, /fullProtectionDisabled/);
  assert.match(
    content,
    /scanClickjackingOverlays\(\)\s*\{\s*if \(!this\.autoHideAds \|\| this\.siteDisabled\) return;/,
  );
  assert.match(inject, /__aiVisionAdBlockerMainInitialized/);
});

test("offscreen inference resolves ONNX runtime WASM from the extension package", () => {
  const source = readText("src/offscreen.ts");

  assert.match(
    source,
    /env\.backends\.onnx\.wasm\.wasmPaths\s*=\s*chrome\.runtime\.getURL\(["']wasm\/["']\)/
  );
});

test("post-build step packages every ONNX Runtime 1.14 WASM fallback", () => {
  const source = readText("scripts/copy-wasm.js");
  const requiredFiles = [
    "ort-wasm.wasm",
    "ort-wasm-simd.wasm",
    "ort-wasm-threaded.wasm",
    "ort-wasm-simd-threaded.wasm",
  ];

  assert.match(source, /node_modules["'],\s*["']onnxruntime-web["'],\s*["']dist/);
  assert.match(source, /path\.join\(distDir,\s*["']wasm["']\)/);

  for (const file of requiredFiles) {
    assert.equal(source.includes(file), true, `copy-wasm.js must package ${file}`);
  }
});

test("Chrome Store privacy policy has a public GitHub Pages HTML source", () => {
  const page = readText("privacy-policy.html");

  assert.match(page, /<title>Privacy Policy — AI Vision Ad Blocker<\/title>/);
  assert.match(page, /does not collect, sell, or transmit personal information/i);
  assert.match(page, /classification runs locally in the browser/i);
  assert.match(page, /not sent to the developer or shared with third parties/i);
  assert.match(page, /https:\/\/github\.com\/dhhieu113pro\/adblocker-extension\/issues/);
  assert.doesNotMatch(page, /<script\b/i);
  assert.doesNotMatch(page, /google-analytics|gtag\(|analytics\.js|googletagmanager/i);
});
