export function shouldAnalyzeImage({ width = 0, height = 0, url = "", alt = "", parentClasses = "" } = {}) {
  const normalizedUrl = String(url).toLowerCase();
  const normalizedAlt = String(alt).toLowerCase();
  const normalizedParentClasses = String(parentClasses).toLowerCase();

  if (normalizedAlt.includes("logo") || normalizedUrl.includes("/logo") || normalizedParentClasses.includes("logo")) {
    return false;
  }

  if (!normalizedUrl || normalizedUrl.startsWith("data:image/svg") || normalizedUrl.startsWith("chrome-extension://")) {
    return false;
  }

  if (width > 0 && height > 0 && (width < 96 || height < 64 || width * height < 12000)) {
    return false;
  }

  return true;
}

export function hasExplicitAdCloseSignal({ text = "", ariaLabel = "", className = "" } = {}) {
  const normalizedText = String(text).toLowerCase();
  const normalizedAria = String(ariaLabel).toLowerCase();
  const normalizedClass = String(className).toLowerCase();

  return normalizedText.includes("qc") ||
    normalizedText.includes("quảng cáo") ||
    normalizedText.includes("advertisement") ||
    normalizedAria.includes("qc") ||
    normalizedAria.includes("quảng cáo") ||
    normalizedAria.includes("advertisement") ||
    normalizedAria.includes("ad close") ||
    normalizedClass.includes("close-ad") ||
    normalizedClass.includes("ad-close") ||
    normalizedClass.includes("no-ads");
}

export function hasExplicitAdOverlayMarker(id = "", className = "") {
  const marker = `${String(id).toLowerCase()} ${String(className).toLowerCase()}`;
  return /(^|[-_ ])(ad|ads|advert|advertisement|banner|sponsor|promo|quangcao|qc)([-_ ]|$)/.test(marker);
}

export function buildImageDetectionRequest({
  imageUrl = "",
  imageDataUrl = "",
  linkUrl = "",
  linkRel = "",
  hasCloseAdButton = false,
  forceAI = false,
} = {}) {
  return {
    type: "detectAd",
    imageUrl,
    imageDataUrl,
    linkUrl,
    linkRel,
    hasCloseAdButton,
    forceAI,
  };
}

export function shouldBlockDetectionResult(result, minimumConfidence = 50) {
  return Boolean(result?.isAd) && Number(result?.confidence || 0) >= minimumConfidence;
}
