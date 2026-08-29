import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contentSource = readFileSync(new URL("../src/content.js", import.meta.url), "utf8");

test("image fingerprint changes when the click destination changes", async () => {
  const policy = await import("../src/image-ad-policy.mjs");
  assert.equal(typeof policy.buildImageFingerprint, "function");

  const first = policy.buildImageFingerprint({
    imageUrl: "https://cdn.example.test/banner.gif",
    linkUrl: "https://example.test/article",
    width: 728,
    height: 90,
  });
  const second = policy.buildImageFingerprint({
    imageUrl: "https://cdn.example.test/banner.gif",
    linkUrl: "https://redirect.example.test/promo",
    width: 728,
    height: 90,
  });

  assert.notEqual(first, second);
});

test("automatic candidate detection considers the outbound click URL", async () => {
  const { shouldAutoAnalyzeImageCandidate } = await import("../src/image-ad-policy.mjs");
  assert.equal(shouldAutoAnalyzeImageCandidate({
    width: 1200,
    height: 800,
    url: "https://cdn.example.test/ordinary-image.jpg",
    linkUrl: "https://8svui.com",
  }), true);
});

test("content script runs a lightweight periodic scan for changed image fingerprints", () => {
  assert.match(contentSource, /processedImageFingerprints\s*=\s*new WeakMap\(\)/);
  assert.match(contentSource, /getImageFingerprint\(img\)/);
  assert.match(contentSource, /scanChangedImages\(\)/);
  assert.match(contentSource, /setInterval\(\(\)\s*=>\s*this\.scanChangedImages\(\),\s*1000\)/);
});
