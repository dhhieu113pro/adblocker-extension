import { pipeline, env } from "@xenova/transformers";

// Configure transformers.js environment for extension offscreen context
env.allowLocalModels = false;
env.allowRemoteModels = true;

let clipClassifier: any = null;
let isClassifierLoading = false;

async function getClipClassifier() {
  if (clipClassifier) return clipClassifier;
  if (isClassifierLoading) {
    while (isClassifierLoading) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (clipClassifier) return clipClassifier;
  }

  isClassifierLoading = true;
  try {
    clipClassifier = await pipeline("zero-shot-image-classification", "Xenova/clip-vit-base-patch16-224");
    return clipClassifier;
  } finally {
    isClassifierLoading = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return false;

  if (message.type === "clipClassifyAd") {
    (async () => {
      try {
        const classifier = await getClipClassifier();
        const candidate_labels = [
          "gambling advertisement banner",
          "promotional ad banner",
          "sports betting banner",
          "regular website photo or graphic"
        ];

        const output = await classifier(message.imageDataUrl, candidate_labels);
        sendResponse({ success: true, results: output });
      } catch (err: any) {
        console.error("[Offscreen CLIP]", err);
        sendResponse({ error: err?.message || String(err) });
      }
    })();
    return true;
  }

  return false;
});
