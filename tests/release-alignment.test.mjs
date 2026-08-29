import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

function readText(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta !== 0) return Math.sign(delta);
  }
  return 0;
}

test("release metadata targets v1.0.13", () => {
  const packageJson = readJson("../package.json");
  const manifest = readJson("../src/manifest.json");

  assert.equal(packageJson.version, "1.0.13");
  assert.equal(manifest.version, "1.0.13");
});

test("lockfile metadata targets v1.0.13", () => {
  const packageLock = readJson("../package-lock.json");

  assert.equal(packageLock.version, "1.0.13");
  assert.equal(packageLock.packages[""].version, "1.0.13");
});

test("release version stays above the published Edge Store baseline", () => {
  const manifest = readJson("../src/manifest.json");

  assert.equal(
    compareVersions(manifest.version, "1.0.11") > 0,
    true,
    `release ${manifest.version} must be higher than published Edge version 1.0.11`,
  );
});

test("popup version is derived from the manifest instead of hard-coded", () => {
  const html = readText("../src/popup.html");
  const popup = readText("../src/popup.ts");

  assert.match(html, /<span class="version" id="version-label"><\/span>/);
  assert.doesNotMatch(html, /v1\.0\.11/);
  assert.match(popup, /chrome\.runtime\.getManifest\(\)\.version/);
  assert.match(popup, /versionLabel\.textContent\s*=\s*`v\$\{[^}]+\}`/);
});

test("fast classifier keeps the legacy storage value but uses accurate user-facing wording", () => {
  const html = readText("../src/popup.html");
  const background = readText("../src/background.ts");

  assert.match(html, /<option value="mobilenet">Fast Local Classifier · Recommended<\/option>/);
  assert.doesNotMatch(html, /MobileNetV4/);
  assert.match(background, /Fast Local Classifier \+ Heuristics/);
  assert.doesNotMatch(background, /MobileNetV4 Image Classification \+ Heuristics/);
});
