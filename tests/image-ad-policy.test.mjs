import test from "node:test";
import assert from "node:assert/strict";

import {
  shouldAnalyzeImage,
  shouldAutoAnalyzeImageCandidate,
  hasExplicitAdCloseSignal,
  hasExplicitAdOverlayMarker,
  buildImageDetectionRequest,
  shouldBlockDetectionResult,
} from "../src/image-ad-policy.mjs";

test("manual image analysis still accepts normal images", () => {
  assert.equal(shouldAnalyzeImage({ width: 1200, height: 800, url: "https://media.saostar.vn/news/article-photo.jpg" }), true);
  assert.equal(shouldAnalyzeImage({ width: 300, height: 250, url: "https://site.test/photo.jpg" }), true);
});

test("automatic analysis skips ordinary editorial photos without ad context", () => {
  assert.equal(shouldAutoAnalyzeImageCandidate({ width: 1200, height: 800, url: "https://media.saostar.vn/news/article-photo.jpg" }), false);
  assert.equal(shouldAutoAnalyzeImageCandidate({ width: 1200, height: 675, url: "https://cdn.site.test/hero.jpg" }), false);
  assert.equal(shouldAutoAnalyzeImageCandidate({ width: 0, height: 0, url: "https://cdn.site.test/lazy-editorial.jpg" }), false);
});

test("automatic analysis restores v1.0.11 banner geometry detection", () => {
  assert.equal(shouldAutoAnalyzeImageCandidate({ width: 728, height: 90, url: "https://cdn.site.test/creative.jpg" }), true);
  assert.equal(shouldAutoAnalyzeImageCandidate({ width: 468, height: 60, url: "https://cdn.site.test/creative.jpg" }), true);
  assert.equal(shouldAutoAnalyzeImageCandidate({ width: 320, height: 50, url: "https://cdn.site.test/creative.jpg" }), true);
  assert.equal(shouldAutoAnalyzeImageCandidate({ width: 300, height: 250, url: "https://cdn.site.test/creative.jpg" }), true);
  assert.equal(shouldAutoAnalyzeImageCandidate({ width: 1000, height: 200, url: "https://cdn.site.test/creative.jpg" }), true);
  assert.equal(shouldAutoAnalyzeImageCandidate({ width: 120, height: 600, url: "https://cdn.site.test/creative.jpg" }), true);
});

test("automatic analysis restores v1.0.11 link and URL ad signals", () => {
  assert.equal(shouldAutoAnalyzeImageCandidate({ width: 1200, height: 800, url: "https://cdn.site.test/photo.jpg", linkRel: "sponsored" }), true);
  assert.equal(shouldAutoAnalyzeImageCandidate({ width: 1200, height: 800, url: "https://cdn.site.test/photo.jpg", linkRel: "nofollow" }), true);
  assert.equal(shouldAutoAnalyzeImageCandidate({ width: 1200, height: 800, url: "https://cdn.site.test/photo.jpg", hasCloseAdButton: true }), true);
  assert.equal(shouldAutoAnalyzeImageCandidate({ width: 300, height: 250, url: "https://doubleclick.net/banner.jpg" }), true);
  assert.equal(shouldAutoAnalyzeImageCandidate({ width: 500, height: 500, url: "https://cdn.site.test/quangcao/creative.jpg" }), true);
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

test("automatic image hiding restores the v1.0.11 confidence threshold", () => {
  assert.equal(shouldBlockDetectionResult(null), false);
  assert.equal(shouldBlockDetectionResult({ isAd: false, confidence: 99 }), false);
  assert.equal(shouldBlockDetectionResult({ isAd: true, confidence: 49 }), false);
  assert.equal(shouldBlockDetectionResult({ isAd: true, confidence: 50 }), true);
  assert.equal(shouldBlockDetectionResult({ isAd: true, confidence: 79 }), true);
  assert.equal(shouldBlockDetectionResult({ isAd: true, confidence: 94 }, 95), false);
  assert.equal(shouldBlockDetectionResult({ isAd: true, confidence: 95 }, 95), true);
  assert.equal(shouldBlockDetectionResult({ isAd: true }), false);
});
