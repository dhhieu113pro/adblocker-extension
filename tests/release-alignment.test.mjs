import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

function readText(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("release metadata targets v0.1.14", () => {
  const packageJson = readJson("../package.json");
  const packageLock = readJson("../package-lock.json");
  const manifest = readJson("../src/manifest.json");

  assert.equal(packageJson.version, "0.1.14");
  assert.equal(packageLock.version, "0.1.14");
  assert.equal(packageLock.packages[""].version, "0.1.14");
  assert.equal(manifest.version, "0.1.14");
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
