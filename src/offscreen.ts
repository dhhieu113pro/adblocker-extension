import { pipeline, env } from "@xenova/transformers";
import {
  chooseEnsembleResults,
  shouldReviewWithSecondModel,
} from "./vision-ensemble-policy.mjs";

// Configure transformers.js environment for extension offscreen context
env.allowLocalModels = false;
env.allowRemoteModels = true;
// Chrome Web Store MV3 requires executable WASM to be packaged with the extension.
// Keep remote model weights enabled, but resolve ONNX Runtime binaries locally.
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("wasm/");

let clipClassifier: any = null;
let isClassifierLoading = false;
let mobileNetClassifier: any = null;
let isMobileNetLoading = false;

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
    clipClassifier = await pipeline("zero-shot-image-classification", "Xenova/clip-vit-base-patch16");
    return clipClassifier;
  } finally {
    isClassifierLoading = false;
  }
}

async function getMobileNetClassifier() {
  if (mobileNetClassifier) return mobileNetClassifier;
  if (isMobileNetLoading) {
    while (isMobileNetLoading) await new Promise((r) => setTimeout(r, 100));
    return mobileNetClassifier;
  }
  isMobileNetLoading = true;
  try {
    mobileNetClassifier = await pipeline(
      "image-classification",
      "Xenova/dit-base-finetuned-rvlcdip"
    );
    return mobileNetClassifier;
  } finally {
    isMobileNetLoading = false;
  }
}

const AD_CANDIDATE_LABELS = [
  "gambling advertisement banner",
  "promotional ad banner",
  "sports betting banner",
  "regular website photo or graphic"
];

async function classifyAdWithModel(model: "clip" | "mobilenet", imageDataUrl: string) {
  if (model === "mobilenet") {
    const classifier = await getMobileNetClassifier();
    return classifier(imageDataUrl);
  }

  const classifier = await getClipClassifier();
  return classifier(imageDataUrl, AD_CANDIDATE_LABELS);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return false;

  if (message.type === "clipClassifyAd") {
    (async () => {
      try {
        const selectedModel: "clip" | "mobilenet" = message.model === "clip" ? "clip" : "mobilenet";
        const primaryOutput = await classifyAdWithModel(selectedModel, message.imageDataUrl);

        let output = primaryOutput;
        let reviewedBy: string | undefined;
        if (shouldReviewWithSecondModel(primaryOutput)) {
          const secondaryModel: "clip" | "mobilenet" = selectedModel === "clip" ? "mobilenet" : "clip";
          const secondaryOutput = await classifyAdWithModel(secondaryModel, message.imageDataUrl);
          output = chooseEnsembleResults(primaryOutput, secondaryOutput);
          reviewedBy = secondaryModel;
        }

        sendResponse({
          success: true,
          results: output,
          model: selectedModel,
          ...(reviewedBy ? { reviewedBy } : {}),
        });
      } catch (err: any) {
        console.error("[Offscreen Vision]", err);
        sendResponse({ error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message.type === "clipClassifyWebsite") {
    (async () => {
      try {
        const classifier = await getClipClassifier();
        const candidate_labels = [
          "a sports betting or online casino gambling website",
          "a movie streaming website with a video player",
          "a manga or comic book reader page with images",
          "a news website article with headers",
          "a clean programming code repository",
          "an e-commerce shopping catalog",
          "a search engine homepage"
        ];

        const output = await classifier(message.imageDataUrl, candidate_labels);
        sendResponse({ success: true, results: output });
      } catch (err: any) {
        console.error("[Offscreen CLIP Website]", err);
        sendResponse({ error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message.type === "clipClassifyAdPage") {
    (async () => {
      try {
        const classifier = await getClipClassifier();
        const candidate_labels = [
          "a sports betting or online casino gambling website",
          "a promotional advertising spam or giveaway page",
          "a clean regular website layout"
        ];

        const output = await classifier(message.imageDataUrl, candidate_labels);
        sendResponse({ success: true, results: output });
      } catch (err: any) {
        console.error("[Offscreen CLIP Ad Page]", err);
        sendResponse({ error: err?.message || String(err) });
      }
    })();
    return true;
  }

  return false;
});
