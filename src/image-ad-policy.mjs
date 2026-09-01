const KNOWN_AD_HOST_MARKERS = [
  "doubleclick.net", "googlesyndication.com", "adservice.google.com", "adnxs.com",
  "taboola.com", "outbrain.com", "admicro.vn", "eclick.vn", "adtima.vn",
];

const EXPLICIT_AD_PATH_SEGMENTS = new Set([
  "ad", "ads", "advert", "advertisement", "banner", "promo", "promotion",
  "sponsor", "sponsored", "quangcao", "qc", "adcenter", "ad-server", "adserver",
]);

function isEligibleImageSource(url, alt, parentClasses) {
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

function parseHttpUrl(value) {
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function hasKnownAdHost(value) {
  const parsed = parseHttpUrl(value);
  if (!parsed) return false;
  const host = parsed.hostname.toLowerCase();
  return KNOWN_AD_HOST_MARKERS.some((marker) => host === marker || host.endsWith(`.${marker}`));
}

function hasExplicitAdPath(value) {
  const parsed = parseHttpUrl(value);
  if (!parsed) return false;
  const segments = parsed.pathname
    .toLowerCase()
    .split(/[\/_\-.]+/)
    .filter(Boolean);
  return segments.some((segment) => EXPLICIT_AD_PATH_SEGMENTS.has(segment));
}

export function shouldAnalyzeImage({ width = 0, height = 0, url = "", alt = "", parentClasses = "" } = {}) {
  if (!isEligibleImageSource(url, alt, parentClasses)) return false;

  if (width > 0 && height > 0 && (width < 96 || height < 64 || width * height < 12000)) {
    return false;
  }

  return true;
}

export function shouldAutoAnalyzeImageCandidate({
  url = "",
  alt = "",
  parentClasses = "",
  linkUrl = "",
  linkRel = "",
  hasCloseAdButton = false,
} = {}) {
  if (!isEligibleImageSource(url, alt, parentClasses)) return false;
  if (hasCloseAdButton) return true;
  if (String(linkRel).toLowerCase().split(/\s+/).includes("sponsored")) return true;
  if (hasKnownAdHost(url) || hasKnownAdHost(linkUrl)) return true;
  return hasExplicitAdPath(url) || hasExplicitAdPath(linkUrl);
}

export function buildImageFingerprint({ imageUrl = "", linkUrl = "", width = 0, height = 0 } = {}) {
  return `${String(imageUrl)}|${String(linkUrl)}|${Number(width)}x${Number(height)}`;
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

export const DEFAULT_AI_THRESHOLDS = Object.freeze({ allowMax: 30, blockMin: 85 });

export function classifyAiDecision(result, thresholds = DEFAULT_AI_THRESHOLDS) {
  if (!result?.isAd) return "allow";
  const confidence = Number(result.confidence || 0);
  if (confidence >= thresholds.blockMin) return "block";
  if (confidence <= thresholds.allowMax) return "allow";
  return "review";
}

export function buildContextReviewRequest({
  imageUrl = "",
  imageDataUrl = "",
  pageUrl = "",
  linkUrl = "",
  linkRel = "",
  hasCloseAdButton = false,
  firstModelResult = null,
} = {}) {
  const page = parseHttpUrl(pageUrl);
  const image = parseHttpUrl(imageUrl);
  const link = parseHttpUrl(linkUrl);
  return {
    type: "detectAd",
    imageUrl,
    imageDataUrl,
    linkUrl,
    linkRel,
    hasCloseAdButton,
    contextReview: true,
    evidence: {
      pageHost: page?.hostname || "",
      imageHost: image?.hostname || "",
      linkHost: link?.hostname || "",
      sponsored: String(linkRel).toLowerCase().split(/\s+/).includes("sponsored"),
      explicitAdControl: Boolean(hasCloseAdButton),
      firstModelIsAd: Boolean(firstModelResult?.isAd),
      firstModelConfidence: Number(firstModelResult?.confidence || 0),
    },
  };
}

export function shouldBlockDetectionResult(result, minimumConfidence = DEFAULT_AI_THRESHOLDS.blockMin) {
  return Boolean(result?.isAd) && Number(result?.confidence || 0) >= minimumConfidence;
}
