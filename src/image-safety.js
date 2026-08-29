import { shouldBlockDetectionResult } from "./image-ad-policy.mjs";

// Auto-scanning should be conservative: a weak visual guess must never hide
// ordinary editorial/content images. Manual forceAI checks still return the
// raw classifier result so users can inspect it without changing behavior.
const originalSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);

chrome.runtime.sendMessage = function guardedSendMessage(message, ...args) {
  if (message?.type !== "detectAd" || message?.forceAI === true) {
    return originalSendMessage(message, ...args);
  }

  const callbackIndex = args.findIndex((arg) => typeof arg === "function");
  if (callbackIndex === -1) return originalSendMessage(message, ...args);

  const callback = args[callbackIndex];
  args[callbackIndex] = (result) => {
    if (result?.success && result?.isAd && !shouldBlockDetectionResult(result)) {
      callback({ ...result, isAd: false, reasons: [...(result.reasons || []), "Not auto-hidden: detection confidence below 80%"] });
      return;
    }
    callback(result);
  };

  return originalSendMessage(message, ...args);
};
