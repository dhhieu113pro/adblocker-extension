import test from "node:test";
import assert from "node:assert/strict";

import {
  shouldAnalyzeImage,
  shouldAutoAnalyzeImageCandidate,
  hasExplicitAdCloseSignal,
  hasExplicitAdOverlayMarker,
  buildImageDetectionRequest,
  buildImageFingerprint,
  classifyAiDecision,
  buildContextReviewRequest,
  shouldBlockDetectionResult,
} from "../src/image-ad-policy.mjs";

test("manual image analysis still accepts normal images", () => {
  assert.equal(shouldAnalyzeImage({ width: 1200, height: 800, url: "https://media.saostar.vn/news/article-photo.jpg" }), true);
  assert.equal(shouldAnalyzeImage({ width: 300, height: 250, url: "https://site.test/photo.jpg" }), true);
});

test("automatic analysis skips normal YouTube, opaque CDN tokens, and IAB-like editorial images", () => {
  assert.equal(shouldAutoAnalyzeImageCandidate(), false);
  assert.equal(shouldAutoAnalyzeImageCandidate({ width: 336, height: 188, url: "https://i.ytimg.com/vi/abc123/hq720.jpg?sqp=qcA9&rs=AOn4CLDadsXYZ", linkUrl: "https://www.youtube.com/watch?v=abc123" }), false);
  assert.equal(shouldAutoAnalyzeImageCandidate({ width: 1200, height: 800, url: "https://cdn.site.test/photo.jpg?sig=abcadsxyzqc123" }), false);
  assert.equal(shouldAutoAnalyzeImageCandidate({ width: 300, height: 250, url: "https://news.site.test/article-photo.jpg" }), false);
  assert.equal(shouldAutoAnalyzeImageCandidate({ width: 1200, height: 800, url: "https://cdn.site.test/article.jpg", linkRel: "nofollow" }), false);
});

test("explicit ad evidence remains eligible for AI analysis", () => {
  assert.equal(shouldAutoAnalyzeImageCandidate({ url: "https://cdn.site.test/photo.jpg", linkRel: "ugc sponsored nofollow" }), true);
  assert.equal(shouldAutoAnalyzeImageCandidate({ url: "https://cdn.site.test/photo.jpg", hasCloseAdButton: true }), true);
  assert.equal(shouldAutoAnalyzeImageCandidate({ url: "https://doubleclick.net/banner.jpg" }), true);
  assert.equal(shouldAutoAnalyzeImageCandidate({ url: "https://cdn.doubleclick.net/creative.jpg" }), true);
  assert.equal(shouldAutoAnalyzeImageCandidate({ url: "https://cdn.site.test/quangcao/creative.jpg" }), true);
  assert.equal(shouldAutoAnalyzeImageCandidate({ url: "https://cdn.site.test/article.jpg", linkUrl: "https://ads.doubleclick.net/click" }), true);
  assert.equal(shouldAutoAnalyzeImageCandidate({ url: "https://cdn.site.test/article.jpg", linkUrl: "https://merchant.test/promo/offer" }), true);
  assert.equal(shouldAutoAnalyzeImageCandidate({ url: "https://cdn.site.test/article.jpg", linkUrl: "not-a-url" }), false);
  assert.equal(shouldAutoAnalyzeImageCandidate({ url: "https://cdn.site.test/article.jpg", linkUrl: "ftp://doubleclick.net/a" }), false);
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

test("fingerprints and AI requests remain stable", () => {
  assert.equal(buildImageFingerprint({ imageUrl: "a", linkUrl: "b", width: 1, height: 2 }), "a|b|1x2");
  assert.equal(buildImageFingerprint(), "||0x0");
  const request = buildImageDetectionRequest({ imageUrl: "https://chat.zalo.me/photo.jpg", imageDataUrl: "data:image/jpeg;base64,abc", linkUrl: "https://chat.zalo.me/", forceAI: true, width: 728, height: 90 });
  assert.equal("width" in request, false);
  assert.equal("height" in request, false);
  assert.equal(request.forceAI, true);
  assert.equal(buildImageDetectionRequest().forceAI, false);
});

test("AI decisions use allow, review, and block confidence zones", () => {
  assert.equal(classifyAiDecision(null), "allow");
  assert.equal(classifyAiDecision({ isAd: false, confidence: 99 }), "allow");
  assert.equal(classifyAiDecision({ isAd: true, confidence: 0 }), "allow");
  assert.equal(classifyAiDecision({ isAd: true, confidence: 30 }), "allow");
  assert.equal(classifyAiDecision({ isAd: true, confidence: 31 }), "review");
  assert.equal(classifyAiDecision({ isAd: true, confidence: 84 }), "review");
  assert.equal(classifyAiDecision({ isAd: true, confidence: 85 }), "block");
  const custom = { allowMax: 50, blockMin: 70 };
  assert.equal(classifyAiDecision({ isAd: true, confidence: 50 }, custom), "allow");
  assert.equal(classifyAiDecision({ isAd: true, confidence: 60 }, custom), "review");
  assert.equal(classifyAiDecision({ isAd: true, confidence: 70 }, custom), "block");
});

test("context review request carries only structured evidence", () => {
  assert.deepEqual(buildContextReviewRequest({
    imageUrl: "https://i.ytimg.com/vi/abc/hq.jpg",
    imageDataUrl: "data:image/jpeg;base64,abc",
    pageUrl: "https://www.youtube.com/watch?v=abc",
    linkUrl: "https://merchant.test/offer",
    linkRel: "sponsored nofollow",
    hasCloseAdButton: true,
    firstModelResult: { isAd: true, confidence: 61 },
  }), {
    type: "detectAd",
    imageUrl: "https://i.ytimg.com/vi/abc/hq.jpg",
    imageDataUrl: "data:image/jpeg;base64,abc",
    linkUrl: "https://merchant.test/offer",
    linkRel: "sponsored nofollow",
    hasCloseAdButton: true,
    contextReview: true,
    evidence: {
      pageHost: "www.youtube.com",
      imageHost: "i.ytimg.com",
      linkHost: "merchant.test",
      sponsored: true,
      explicitAdControl: true,
      firstModelIsAd: true,
      firstModelConfidence: 61,
    },
  });
  const normal = buildContextReviewRequest({
    pageUrl: "https://news.site.test/article",
    imageUrl: "https://cdn.site.test/photo.jpg",
    linkUrl: "https://news.site.test/article",
    linkRel: "nofollow",
    firstModelResult: { isAd: false, confidence: 75 },
  });
  assert.equal(normal.evidence.sponsored, false);
  assert.equal(normal.evidence.explicitAdControl, false);
  assert.equal(normal.evidence.firstModelIsAd, false);
  assert.equal(normal.evidence.firstModelConfidence, 75);
  const empty = buildContextReviewRequest({ pageUrl: "bad", imageUrl: "bad", linkUrl: "bad" });
  assert.equal(empty.evidence.pageHost, "");
  assert.equal(empty.evidence.imageHost, "");
  assert.equal(empty.evidence.linkHost, "");
  assert.equal(empty.evidence.sponsored, false);
  assert.equal(empty.evidence.explicitAdControl, false);
  assert.equal(empty.evidence.firstModelIsAd, false);
  assert.equal(empty.evidence.firstModelConfidence, 0);
});

test("automatic blocking defaults to the conservative threshold", () => {
  assert.equal(shouldBlockDetectionResult(null), false);
  assert.equal(shouldBlockDetectionResult({ isAd: false, confidence: 99 }), false);
  assert.equal(shouldBlockDetectionResult({ isAd: true }), false);
  assert.equal(shouldBlockDetectionResult({ isAd: true, confidence: 84 }), false);
  assert.equal(shouldBlockDetectionResult({ isAd: true, confidence: 85 }), true);
  assert.equal(shouldBlockDetectionResult({ isAd: true, confidence: 94 }, 95), false);
  assert.equal(shouldBlockDetectionResult({ isAd: true, confidence: 95 }, 95), true);
});
