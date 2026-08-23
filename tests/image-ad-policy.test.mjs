import test from "node:test";
import assert from "node:assert/strict";

import {
  shouldAnalyzeImage,
  hasExplicitAdCloseSignal,
  hasExplicitAdOverlayMarker,
  buildImageDetectionRequest,
  shouldBlockDetectionResult,
} from "../src/image-ad-policy.mjs";

test("normal images are analyzed regardless of aspect ratio", () => {
  assert.equal(shouldAnalyzeImage({ width: 1200, height: 200, url: "https://chat.zalo.me/photo-wide.jpg" }), true);
  assert.equal(shouldAnalyzeImage({ width: 200, height: 1200, url: "https://chat.zalo.me/photo-tall.jpg" }), true);
  assert.equal(shouldAnalyzeImage({ width: 300, height: 250, url: "https://chat.zalo.me/photo-iab-size.jpg" }), true);
  assert.equal(shouldAnalyzeImage({ width: 728, height: 90, url: "https://chat.zalo.me/photo-banner-size.jpg" }), true);
});

test("obvious UI and branding images are skipped", () => {
  assert.equal(shouldAnalyzeImage({ width: 200, height: 200, url: "https://site.test/avatar.png", alt: "Company Logo" }), false);
  assert.equal(shouldAnalyzeImage({ width: 200, height: 200, url: "https://site.test/logo/main.png" }), false);
  assert.equal(shouldAnalyzeImage({ width: 200, height: 200, url: "https://site.test/image.png", parentClasses: "header logo-brand" }), false);
  assert.equal(shouldAnalyzeImage({ width: 200, height: 200, url: "" }), false);
  assert.equal(shouldAnalyzeImage({ width: 200, height: 200, url: "data:image/svg+xml;base64,AAAA" }), false);
  assert.equal(shouldAnalyzeImage({ width: 200, height: 200, url: "chrome-extension://abc/icon.png" }), false);
});

test("tiny images are skipped only as an AI cost optimization", () => {
  assert.equal(shouldAnalyzeImage({ width: 95, height: 200, url: "https://site.test/a.png" }), false);
  assert.equal(shouldAnalyzeImage({ width: 200, height: 63, url: "https://site.test/b.png" }), false);
  assert.equal(shouldAnalyzeImage({ width: 100, height: 100, url: "https://site.test/c.png" }), false);
  assert.equal(shouldAnalyzeImage({ width: 0, height: 0, url: "https://site.test/lazy.png" }), true);
  assert.equal(shouldAnalyzeImage(), false);
});

test("generic close buttons are not ad signals", () => {
  assert.equal(hasExplicitAdCloseSignal({ text: "Close" }), false);
  assert.equal(hasExplicitAdCloseSignal({ text: "Đóng" }), false);
  assert.equal(hasExplicitAdCloseSignal({ ariaLabel: "Close image viewer" }), false);
  assert.equal(hasExplicitAdCloseSignal({ className: "modal-close" }), false);
  assert.equal(hasExplicitAdCloseSignal(), false);
});

test("explicit ad close markers are recognized", () => {
  assert.equal(hasExplicitAdCloseSignal({ text: "QC" }), true);
  assert.equal(hasExplicitAdCloseSignal({ text: "Đóng quảng cáo" }), true);
  assert.equal(hasExplicitAdCloseSignal({ text: "Close advertisement" }), true);
  assert.equal(hasExplicitAdCloseSignal({ ariaLabel: "QC" }), true);
  assert.equal(hasExplicitAdCloseSignal({ ariaLabel: "Đóng quảng cáo" }), true);
  assert.equal(hasExplicitAdCloseSignal({ ariaLabel: "Advertisement" }), true);
  assert.equal(hasExplicitAdCloseSignal({ ariaLabel: "Ad close" }), true);
  assert.equal(hasExplicitAdCloseSignal({ className: "close-ad" }), true);
  assert.equal(hasExplicitAdCloseSignal({ className: "ad-close" }), true);
  assert.equal(hasExplicitAdCloseSignal({ className: "no-ads-under" }), true);
});

test("only explicit ad overlay markers are accepted", () => {
  assert.equal(hasExplicitAdOverlayMarker("photo-modal", "viewer overlay"), false);
  assert.equal(hasExplicitAdOverlayMarker("", "popup"), false);
  assert.equal(hasExplicitAdOverlayMarker("ad-overlay", "fixed"), true);
  assert.equal(hasExplicitAdOverlayMarker("viewer", "banner overlay"), true);
  assert.equal(hasExplicitAdOverlayMarker("promo_modal", ""), true);
  assert.equal(hasExplicitAdOverlayMarker(), false);
});

test("AI image request intentionally contains no geometry fields", () => {
  const request = buildImageDetectionRequest({
    imageUrl: "https://chat.zalo.me/photo.jpg",
    imageDataUrl: "data:image/jpeg;base64,abc",
    linkUrl: "https://chat.zalo.me/",
    linkRel: "",
    hasCloseAdButton: false,
    forceAI: true,
    width: 728,
    height: 90,
  });

  assert.deepEqual(request, {
    type: "detectAd",
    imageUrl: "https://chat.zalo.me/photo.jpg",
    imageDataUrl: "data:image/jpeg;base64,abc",
    linkUrl: "https://chat.zalo.me/",
    linkRel: "",
    hasCloseAdButton: false,
    forceAI: true,
  });
  assert.equal("width" in request, false);
  assert.equal("height" in request, false);
  assert.deepEqual(buildImageDetectionRequest(), {
    type: "detectAd",
    imageUrl: "",
    imageDataUrl: "",
    linkUrl: "",
    linkRel: "",
    hasCloseAdButton: false,
    forceAI: false,
  });
});

test("blocking requires an ad result at or above confidence threshold", () => {
  assert.equal(shouldBlockDetectionResult(null), false);
  assert.equal(shouldBlockDetectionResult({ isAd: false, confidence: 99 }), false);
  assert.equal(shouldBlockDetectionResult({ isAd: true, confidence: 49 }), false);
  assert.equal(shouldBlockDetectionResult({ isAd: true, confidence: 50 }), true);
  assert.equal(shouldBlockDetectionResult({ isAd: true, confidence: 79 }, 80), false);
  assert.equal(shouldBlockDetectionResult({ isAd: true, confidence: 80 }, 80), true);
  assert.equal(shouldBlockDetectionResult({ isAd: true }), false);
});
