import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/content.js", import.meta.url), "utf8");

test("reused image nodes are reprocessed when their source changes", () => {
  assert.match(source, /processedImageUrls\s*=\s*new WeakMap\(\)/);
  assert.match(source, /this\.processedImageUrls\.get\(img\)\s*===\s*imgSrc/);
  assert.match(source, /this\.processedImageUrls\.set\(img,\s*imgSrc\)/);
});

test("SPA navigation clears page-scoped detections and triggers an immediate rescan", () => {
  assert.match(source, /currentPageUrl\s*=\s*window\.location\.href/);
  assert.match(source, /handlePageNavigation\(\)/);
  assert.match(source, /this\.detectedAdsMap\.clear\(\)/);
  assert.match(source, /if\s*\(window\.location\.href\s*!==\s*this\.currentPageUrl\)/);
  assert.match(source, /this\.scanImages\(\)/);
});
