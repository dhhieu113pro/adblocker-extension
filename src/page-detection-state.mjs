function normalizePageKey(value) {
  const text = String(value || "");
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return text.split("#")[0];
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return text.split("#")[0];
  }
}

function detectionKey(ad = {}) {
  const url = String(ad.url || ad.adUrl || ad.sourceUrl || ad.blockedTargetUrl || "");
  if (url) return `url:${url}`;

  const domain = String(ad.domain || ad.adDomain || "");
  const method = String(ad.method || ad.detectionMethod || "");
  const width = Number(ad.width) || 0;
  const height = Number(ad.height) || 0;
  return `fallback:${domain}|${method}|${width}x${height}`;
}

export function createPageDetectionState(initialUrl = "") {
  let currentPageKey = normalizePageKey(initialUrl);
  const detections = new Map();

  function record(ad = {}) {
    const key = detectionKey(ad);
    if (detections.has(key)) return false;
    detections.set(key, { ...ad });
    return true;
  }

  function navigate(nextUrl = "") {
    const nextPageKey = normalizePageKey(nextUrl);
    if (nextPageKey === currentPageKey) return false;
    currentPageKey = nextPageKey;
    detections.clear();
    return true;
  }

  function reset(nextUrl = "") {
    currentPageKey = normalizePageKey(nextUrl);
    detections.clear();
  }

  return {
    record,
    navigate,
    reset,
    count: () => detections.size,
    list: () => Array.from(detections.values()),
  };
}
