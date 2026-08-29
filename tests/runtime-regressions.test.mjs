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
  assert.match(source, /shouldBlockDetectionResult\(res\)/);
});

test("CLIP is the default vision model as in v1.0.11", () => {
  const source = readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");
  const fallbacks = source.match(/visionModel \|\| "clip"/g) || [];
  assert.equal(fallbacks.length, 2);
});
