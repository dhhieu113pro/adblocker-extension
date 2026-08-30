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

test("content script uses an adaptive lightweight safety scan", () => {
  assert.match(contentSource, /processedImageFingerprints\s*=\s*new WeakMap\(\)/);
  assert.match(contentSource, /getImageFingerprint\(img\)/);
  assert.match(contentSource, /scanChangedImages\(\)/);
  assert.match(contentSource, /safetyScanFastMs\s*=\s*1000/);
  assert.match(contentSource, /safetyScanIdleMs\s*=\s*4000/);
  assert.match(contentSource, /safetyScanActiveWindowMs\s*=\s*10000/);
  assert.match(contentSource, /setupAdaptiveSafetyScan\(\)/);
  assert.match(contentSource, /scheduleSafetyScan\(\)/);
  assert.doesNotMatch(contentSource, /setInterval\(\(\)\s*=>\s*this\.scanChangedImages\(\),\s*1000\)/);
});

test("adaptive safety scan pauses while the page is hidden", () => {
  assert.match(contentSource, /addEventListener\("visibilitychange"/);
  assert.match(contentSource, /document\.hidden/);
  assert.match(contentSource, /stopSafetyScan\(\)/);
});

test("SPA and DOM activity return the safety scan to the fast cadence", () => {
  const activityCalls = contentSource.match(/markSafetyScanActivity\(\)/g) || [];
  assert.ok(activityCalls.length >= 3, "navigation and DOM changes should refresh the fast safety-scan window");
});

test("SPA activity does not postpone an already imminent safety scan", () => {
  const activityMethod = contentSource.match(/markSafetyScanActivity\(\)\s*\{([\s\S]*?)\n\s*\}/)?.[1] || "";
  assert.match(activityMethod, /lastSafetyScanActivityAt\s*=\s*Date\.now\(\)/);
  assert.match(activityMethod, /!this\.safetyScanTimer/);
  assert.doesNotMatch(activityMethod, /this\.stopSafetyScan\(\)/);
});
