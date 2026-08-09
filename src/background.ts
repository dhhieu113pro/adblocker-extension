chrome.runtime.onInstalled.addListener(() => {
  console.log("AI Vision Ad Blocker extension installed");
  chrome.contextMenus.create({
    id: "analyze-image-ad",
    title: "✨ Analyze with AI & Detect Ad",
    contexts: ["image"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "analyze-image-ad" && tab?.id && info.srcUrl) {
    chrome.tabs.sendMessage(tab.id, {
      type: "analyzeContextImage",
      imageUrl: info.srcUrl,
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "fetchImageAsBase64") {
    (async () => {
      try {
        const resp = await fetch(message.url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const reader = new FileReader();
        reader.onloadend = () => sendResponse({ base64: reader.result as string });
        reader.onerror = (e) => sendResponse({ error: String(e) });
        reader.readAsDataURL(blob);
      } catch (err: any) {
        sendResponse({ error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message.type === "detectAd") {
    (async () => {
      try {
        const heuristics = analyzeAdHeuristics(
          message.imageUrl, 
          message.width, 
          message.height,
          message.linkUrl,
          message.linkRel,
          message.hasCloseAdButton
        );

        if (heuristics.confidence >= 60 && !message.forceAI) {
          sendResponse({
            success: true,
            isAd: true,
            confidence: heuristics.confidence,
            method: "Heuristic Rules Engine",
            reasons: heuristics.reasons,
          });
          return;
        }

        if (message.imageDataUrl) {
          await ensureOffscreenDocument();
          const aiResult = await chrome.runtime.sendMessage({
            type: "clipClassifyAd",
            imageDataUrl: message.imageDataUrl,
            target: "offscreen",
          });

          if (aiResult?.results && Array.isArray(aiResult.results)) {
            const topResult = aiResult.results[0];
            const isAdFromAI = topResult.label.includes("advertisement") || topResult.label.includes("banner");
            const aiConfidence = Math.round(topResult.score * 100);

            sendResponse({
              success: true,
              isAd: isAdFromAI || heuristics.isAd,
              confidence: Math.max(aiConfidence, heuristics.confidence),
              method: "CLIP Zero-Shot AI + Heuristics",
              reasons: [
                `AI Classification: "${topResult.label}" (${aiConfidence}%)`,
                ...heuristics.reasons,
              ],
            });
            return;
          }
        }

        sendResponse({
          success: true,
          isAd: heuristics.isAd,
          confidence: heuristics.confidence,
          method: "Heuristic Rules Engine",
          reasons: heuristics.reasons.length > 0 ? heuristics.reasons : ["Standard web image dimensions"],
        });
      } catch (err: any) {
        sendResponse({ error: err?.message || String(err) });
      }
    })();
    return true;
  }

  return false;
});

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL("offscreen.html");
  const existingContexts = await (chrome as any).runtime.getContexts?.({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  }) ?? [];

  if (existingContexts.length === 0) {
    await (chrome as any).offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["BLOBS"],
      justification: "Run MediaPipe & CLIP WASM vision tasks in extension page context",
    });
  }
}

function analyzeAdHeuristics(
  imgUrl: string,
  width?: number,
  height?: number,
  linkUrl?: string,
  linkRel?: string,
  hasCloseAdButton?: boolean
) {
  const reasons: string[] = [];
  let score = 0;

  if (width && height && height > 0) {
    const aspectRatio = width / height;
    const inverseRatio = height / width;

    if (aspectRatio >= 3.0) {
      score += 45;
      reasons.push(`Wide banner aspect ratio (${aspectRatio.toFixed(1)}:1)`);
    } else if (inverseRatio >= 3.0) {
      score += 45;
      reasons.push(`Skyscraper banner aspect ratio (1:${inverseRatio.toFixed(1)})`);
    }

    const iabSizes = [
      [728, 90], [468, 60], [320, 50], [300, 250], [336, 280],
      [120, 600], [160, 600], [300, 600], [970, 90], [970, 250], [300, 100]
    ];
    const isIabSize = iabSizes.some(([w, h]) => Math.abs(w - width) <= 25 && Math.abs(h - height) <= 20);
    if (isIabSize) {
      score += 35;
      reasons.push(`Standard IAB ad dimension (${width}x${height}px)`);
    }
  }

  const lowerUrl = (imgUrl || "").toLowerCase();

  // Add adcenter to keywords
  const adKeywords = [
    "storage/images/other", "api.mamphim", "banner", "ads", "adserver",
    "vsbet", "colatv", "8svui", "i9.top", "betting", "casino", "nhacai",
    "hoahong", "promotions", "affiliate", "sponsor", "game", "worldcup",
    "eclick", "smartads", "adtima", "shopping", "video_sma", "vma-poster",
    "adsbyeclick", "t.eclick.vn", "static.eclick.vn", "s.eclick.vn",
    "adcenter"
  ];
  const matchedKeywords = adKeywords.filter((kw) => lowerUrl.includes(kw));
  if (matchedKeywords.length > 0) {
    score += matchedKeywords.length * 25;
    reasons.push(`Ad URL patterns detected (${matchedKeywords.join(", ")})`);
  }

  if (lowerUrl.endsWith(".gif") && (lowerUrl.includes("storage") || lowerUrl.includes("other") || lowerUrl.includes("api"))) {
    score += 20;
    reasons.push("Animated GIF banner on asset server");
  }

  if (linkRel && linkRel.toLowerCase().includes("sponsored")) {
    score += 60;
    reasons.push("Image wrapped in a 'sponsored' link");
  }

  if (linkUrl) {
    const lowerLink = linkUrl.toLowerCase();
    // Raw IP address link check (common for ad networks)
    if (/https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(lowerLink)) {
      score += 45;
      reasons.push("Link redirects to a raw IP address");
    }
  }

  if (hasCloseAdButton) {
    score += 50;
    reasons.push("Parent container has close-ad controls");
  }

  const confidence = Math.min(Math.round(score), 99);
  return {
    isAd: confidence >= 40,
    confidence,
    reasons,
  };
}
