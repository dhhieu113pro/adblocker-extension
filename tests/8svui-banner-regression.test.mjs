import test from "node:test";
import assert from "node:assert/strict";

import {
  shouldAutoAnalyzeImageCandidate,
  shouldBlockDetectionResult,
} from "../src/image-ad-policy.mjs";

const banner = {
  width: 728,
  height: 90,
  url: "https://api.mamphim.site//storage/images/other/xR0oMNmOKtSX9fpJKrC0vkji0nNLn6aB52EK7.gif",
  alt: "",
  parentClasses: "display-single is-demo adscatfish-item",
  linkUrl: "https://8svui.com",
  linkRel: "",
  hasCloseAdButton: false,
};

test("8svui mamphim GIF banner is always selected for automatic ad analysis", () => {
  assert.equal(shouldAutoAnalyzeImageCandidate(banner), true);
});

test("8svui banner heuristic result at blocking confidence is hidden", () => {
  assert.equal(shouldBlockDetectionResult({
    isAd: true,
    confidence: 99,
    method: "Heuristic Rules Engine",
    reasons: [
      "Wide banner aspect ratio (8.1:1)",
      "Standard IAB ad dimension (728x90px)",
      "Ad URL patterns detected (storage/images/other, api.mamphim)",
      "Animated GIF banner on asset server",
    ],
  }), true);
});
