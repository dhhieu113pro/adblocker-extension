import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("unified release builds once and fans out the same artifact", () => {
  const release = read(".github/workflows/release.yml");
  const edge = read(".github/workflows/edge-store.yml");
  const chrome = read(".github/workflows/chrome-store.yml");

  assert.equal((release.match(/npm run build/g) ?? []).length, 1);
  assert.equal((edge.match(/npm run build/g) ?? []).length, 0);
  assert.equal((chrome.match(/npm run build/g) ?? []).length, 0);

  assert.match(release, /uses: \.\/\.github\/workflows\/edge-store\.yml/);
  assert.match(release, /uses: \.\/\.github\/workflows\/chrome-store\.yml/);
  assert.match(release, /actions\/upload-artifact@v4/);
  assert.match(edge, /actions\/download-artifact@v5/);
  assert.match(chrome, /actions\/download-artifact@v5/);
});

test("browser-specific release tags and Chrome API v1 are removed", () => {
  const release = read(".github/workflows/release.yml");
  const edge = read(".github/workflows/edge-store.yml");
  const chrome = read(".github/workflows/chrome-store.yml");
  const workflows = `${release}\n${edge}\n${chrome}`;

  assert.doesNotMatch(workflows, /v\*-edge/);
  assert.doesNotMatch(workflows, /chromewebstore\/v1\.1/);
  assert.doesNotMatch(workflows, /-chrome|-brave|-chromium/);

  assert.match(chrome, /chromewebstore\.googleapis\.com\/upload\/v2\//);
  assert.match(chrome, /chromewebstore\.googleapis\.com\/v2\/publishers\/\$PUBLISHER_ID\/items\/\$EXTENSION_ID:fetchStatus/);
  assert.match(chrome, /chromewebstore\.googleapis\.com\/v2\/publishers\/\$PUBLISHER_ID\/items\/\$EXTENSION_ID:publish/);
});

test("release metadata is synchronized at 1.0.12", () => {
  const manifest = JSON.parse(read("src/manifest.json"));
  const packageJson = JSON.parse(read("package.json"));
  const packageLock = JSON.parse(read("package-lock.json"));

  assert.equal(manifest.version, "1.0.12");
  assert.equal(packageJson.version, "1.0.12");
  assert.equal(packageLock.version, "1.0.12");
  assert.equal(packageLock.packages[""].version, "1.0.12");
});
