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

test("Chrome Store manifest keeps only required broad-access permissions", () => {
  const manifest = readJson("src/manifest.json");

  assert.equal(manifest.permissions.includes("activeTab"), false);
  assert.equal(manifest.permissions.includes("tabs"), false);
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
  assert.equal(
    manifest.content_security_policy?.extension_pages,
    "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
  );
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
