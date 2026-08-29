const AD_URL_MARKERS = [
  "storage/images/other", "api.mamphim", "banner", "ads", "adserver",
  "vsbet", "colatv", "8svui", "i9.top", "betting", "casino", "nhacai",
  "hoahong", "promotions", "affiliate", "sponsor", "game", "worldcup",
  "eclick", "smartads", "adtima", "static.znews.vn/banner", "adsbyeclick",
  "promo", "quangcao", "qc", "adcenter", "ad-center", "advert", "popup",
  "populartooth", "admicro", "adnzone", "admzone", "doubleclick",
  "googlesyndication", "adservice", "adnxs", "taboola", "outbrain",
];

const IAB_IMAGE_SIZES = [
  [728, 90], [468, 60], [320, 50], [300, 250], [336, 280],
  [120, 600], [160, 600], [300, 600], [970, 90], [970, 250], [300, 100],
];

function isEligibleImageSource({ url = "", alt = "", parentClasses = "" }) {
  const normalizedUrl = String(url).toLowerCase();
  const normalizedAlt = String(alt).toLowerCase();
  const normalizedParentClasses = String(parentClasses).toLowerCase();

  if (normalizedAlt.includes("logo") || normalizedUrl.includes("/logo") || normalizedParentClasses.includes("logo")) {
    return false;
  }

  return Boolean(normalizedUrl) &&
    !normalizedUrl.startsWith("data:image/svg") &&
    !normalizedUrl.startsWith("chrome-extension://");
}

export function shouldAnalyzeImage({ width = 0, height = 0, url = "", alt = "", parentClasses = "" } = {}) {
  if (!isEligibleImageSource({ url, alt, parentClasses })) return false;

  if (width > 0 && height > 0 && (width < 96 || height < 64 || width * height < 12000)) {
    return false;
  }

  return true;
}

export function shouldAutoAnalyzeImageCandidate({
  width = 0,
  height = 0,
  url = "",
  alt = "",
  parentClasses = "",
  linkRel = "",
  hasCloseAdButton = false,
} = {}) {
  if (!isEligibleImageSource({ url, alt, parentClasses })) return false;

  if (width > 0 && height > 0) {
    const ratio = width / height;
    const inverseRatio = height / width;
    if (ratio >= 3.0 || inverseRatio >= 3.0) return true;

    const isIabSize = IAB_IMAGE_SIZES.some(
      ([iabWidth, iabHeight]) => Math.abs(iabWidth - width) <= 25 && Math.abs(iabHeight - height) <= 20,
    );
    if (isIabSize) return true;
  }

  const normalizedUrl = String(url).toLowerCase();
  if (AD_URL_MARKERS.some((marker) => normalizedUrl.includes(marker))) return true;

  const normalizedRel = String(linkRel).toLowerCase();
  if (normalizedRel.includes("sponsored") || normalizedRel.includes("nofollow")) return true;

  return Boolean(hasCloseAdButton);
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
