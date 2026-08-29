import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldRemoveTransparentAdOverlay } from "../src/transparent-ad-overlay-policy.mjs";

test("generic transparent viewport overlays are not removed without an explicit ad marker", () => {
  assert.equal(shouldRemoveTransparentAdOverlay({
    id: "search-overlay",
    className: "fixed transparent-layer",
    position: "fixed",
    zIndex: 1000,
    width: 1200,
    height: 700,
    viewWidth: 1200,
    viewHeight: 700,
    backgroundColor: "transparent",
    opacity: 1,
    pointerEvents: "auto",
    textLength: 0,
    interactiveDescendantCount: 0,
  }), false);
});

test("explicit transparent ad overlays remain removable", () => {
  assert.equal(shouldRemoveTransparentAdOverlay({
    id: "ad-overlay",
    className: "fixed transparent-layer",
    position: "fixed",
    zIndex: 1000,
    width: 1200,
    height: 700,
    viewWidth: 1200,
    viewHeight: 700,
    backgroundColor: "transparent",
    opacity: 1,
    pointerEvents: "auto",
    textLength: 0,
    interactiveDescendantCount: 0,
  }), true);
});

test("fast ad classifier uses a Transformers.js v2-compatible advertisement model", () => {
  const source = readFileSync(new URL("../src/offscreen.ts", import.meta.url), "utf8");
  assert.match(source, /Xenova\/dit-base-finetuned-rvlcdip/);
  assert.doesNotMatch(source, /mobilenetv4_conv_small|mobilenet_v4/);
});

test("content script delegates transparent overlay removal to the explicit ad policy", () => {
  const source = readFileSync(new URL("../src/content.js", import.meta.url), "utf8");
  assert.match(source, /shouldRemoveTransparentAdOverlay/);
  assert.doesNotMatch(source, /console\.warn\("\[AdBlocker\] Detected transparent clickjacking overlay/);
});

test("content script uses the restored v1.0.11 image candidate policy", () => {
  const source = readFileSync(new URL("../src/content.js", import.meta.url), "utf8");
  assert.match(source, /shouldAutoAnalyzeImageCandidate/);
  assert.match(source, /imageUrl: imgSrc, width, height, linkUrl, linkRel, hasCloseAdButton/);
  assert.match(source, /shouldBlockDetectionResult\((?:preflight|result|res)\)/);
});

test("CLIP is the default vision model as in v1.0.11", () => {
  const source = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
  const fallbacks = source.match(/visionModel \|\| "clip"/g) || [];
  assert.equal(fallbacks.length, 2);
});

test("automatic image checks use a cache and heuristic preflight before fetching pixels", () => {
  const source = readFileSync(new URL("../src/content.js", import.meta.url), "utf8");
  const preflight = source.indexOf("preflightOnly: true");
  const fetchPixels = source.indexOf("fetchImageDataUrl(msg.imageUrl)");
  assert.ok(preflight >= 0, "content script should request a fast preflight decision");
  assert.ok(fetchPixels > preflight, "pixel fetch must happen only after preflight");
});

test("automatic image checks have bounded parallelism and no artificial 200ms throttle", () => {
  const source = readFileSync(new URL("../src/content.js", import.meta.url), "utf8");
  assert.match(source, /maxConcurrentAdChecks\s*=\s*3/);
  assert.doesNotMatch(source, /setTimeout\(r,\s*200\)/);
});

test("remote rule refresh does not block the first page scan", () => {
  const source = readFileSync(new URL("../src/content.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /await\s+loadRemoteAdRules\(\)/);
  assert.match(source, /loadRemoteAdRules\(\)\.then/);
});

test("content protection starts at document_start to minimize ad flash", () => {
  const source = readFileSync(new URL("../src/site-access.ts", import.meta.url), "utf8");
  const contentRegistration = source.slice(source.indexOf(`id: CONTENT_SCRIPT_ID`));
  assert.match(contentRegistration, /runAt:\s*"document_start"/);
});
