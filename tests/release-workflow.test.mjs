import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("unified release builds once and publishes the same artifact to GitHub and Edge", () => {
  const release = read(".github/workflows/release.yml");
  const edge = read(".github/workflows/edge-store.yml");

  assert.equal((release.match(/npm run build/g) ?? []).length, 1);
  assert.equal((edge.match(/npm run build/g) ?? []).length, 0);

  assert.match(release, /uses: \.\/\.github\/workflows\/edge-store\.yml/);
  assert.match(release, /actions\/upload-artifact@v4/);
  assert.match(release, /actions\/download-artifact@v5/);
  assert.match(edge, /actions\/download-artifact@v5/);
});

test("Chrome Web Store publishing is removed while generic Chromium release remains", () => {
  const release = read(".github/workflows/release.yml");
  const edge = read(".github/workflows/edge-store.yml");
  const workflows = `${release}\n${edge}`;

  assert.equal(existsSync(".github/workflows/chrome-store.yml"), false);
  assert.doesNotMatch(workflows, /chrome-store\.yml/);
  assert.doesNotMatch(workflows, /CHROME_/);
  assert.doesNotMatch(workflows, /chromewebstore\.googleapis\.com/);
  assert.doesNotMatch(workflows, /v\*-edge/);
  assert.doesNotMatch(workflows, /-chrome|-brave|-chromium/);
});

test("release metadata stays synchronized", () => {
  const manifest = JSON.parse(read("src/manifest.json"));
  const packageJson = JSON.parse(read("package.json"));

  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.version, "1.0.12");
});
