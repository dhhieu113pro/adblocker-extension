if (!globalThis.__aiVisionReportBridgeInitialized) {
  globalThis.__aiVisionReportBridgeInitialized = true;

  window.addEventListener("aiVisionPopupBlocked", (event) => {
    const blockedTargetUrl = typeof event?.detail?.url === "string" ? event.detail.url : "";
    if (!blockedTargetUrl) return;

    chrome.runtime.sendMessage({
      type: "protectionBlocked",
      pageUrl: window.location.href,
      sourceUrl: blockedTargetUrl,
      blockedTargetUrl,
      blockType: "popup",
      detectionMethod: "heuristic",
      resourceType: "popup",
    }).catch(() => undefined);
  });
}
