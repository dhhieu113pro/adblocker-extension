const tabBlockedCounts = new Map<number, number>();
const tabCategories = new Map<number, { category: string, confidence: number }>();

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    tabBlockedCounts.set(tabId, 0);
    tabCategories.delete(tabId);
    chrome.action.setBadgeText({ tabId, text: "" });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabBlockedCounts.delete(tabId);
  tabCategories.delete(tabId);
});

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getTabCategory") {
    const data = tabCategories.get(message.tabId) || { category: "General Site", confidence: 0 };
    sendResponse(data);
    return true;
  }

  if (message.type === "adBlocked") {
    const tabId = sender.tab?.id;
    if (tabId !== undefined) {
      const currentCount = tabBlockedCounts.get(tabId) || 0;
      const newCount = currentCount + 1;
      tabBlockedCounts.set(tabId, newCount);
      chrome.action.setBadgeText({ tabId, text: newCount.toString() });
      chrome.action.setBadgeBackgroundColor({ tabId, color: "#ef4444" });
    }

    if (message.adUrl) {
      chrome.storage.local.get(["adBlockHistory"], (res) => {
        const history = res.adBlockHistory || [];
        const existingIndex = history.findIndex((h: any) => h.url === message.adUrl);
        if (existingIndex > -1) {
          history[existingIndex].count = (history[existingIndex].count || 1) + 1;
          history[existingIndex].timestamp = Date.now();
          history[existingIndex].pageUrl = message.pageUrl || history[existingIndex].pageUrl;
        } else {
          history.unshift({
            url: message.adUrl,
            domain: message.adDomain || "unknown",
            pageUrl: message.pageUrl || "unknown",
            timestamp: Date.now(),
            count: 1
          });
        }
        if (history.length > 100) {
          history.length = 100;
        }
        chrome.storage.local.set({ adBlockHistory: history });
      });
    }

    sendResponse({ success: true });
    return true;
  }

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
    "adcenter", "populartooth", "admicro", "adnzone", "admzone"
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

function getCoreDomain(host: string): string {
  const parts = host.toLowerCase().split(".");
  if (parts.length < 2) return host;
  const commonSubTlds = ["com", "co", "net", "org", "gov", "edu"];
  const secondToLast = parts[parts.length - 2];
  if (parts.length >= 3 && commonSubTlds.includes(secondToLast)) {
    return parts[parts.length - 3];
  }
  return secondToLast;
}

function isExternalAdUrl(targetUrlStr: string, sourceUrlStr: string): boolean {
  try {
    const targetUrl = new URL(targetUrlStr);
    const sourceUrl = new URL(sourceUrlStr);
    
    if (targetUrl.protocol === "chrome-extension:" || targetUrl.protocol === "about:") {
      return false;
    }
    
    const targetHost = targetUrl.hostname.toLowerCase();
    const sourceHost = sourceUrl.hostname.toLowerCase();
    
    if (!targetHost || targetHost === sourceHost || targetHost.endsWith("." + sourceHost)) {
      return false;
    }

    // Allow same core brand domain (e.g. phimmoichill.tv on phimmoichill.club)
    if (getCoreDomain(targetHost) === getCoreDomain(sourceHost)) {
      return false;
    }
    
    const whitelist = [
      "google.com", "facebook.com", "github.com", "twitter.com", 
      "apple.com", "microsoft.com", "youtube.com", "vimeo.com", 
      "imdb.com", "wikipedia.org", "discord.com", "reddit.com"
    ];
    if (whitelist.some(domain => targetHost === domain || targetHost.endsWith("." + domain))) {
      return false;
    }
    
    return true; // Different domain & not whitelisted -> Yes, block!
  } catch (e) {
    return true;
  }
}

function isStreamingOrAdProneSite(urlStr: string, tabId?: number): boolean {
  if (tabId !== undefined) {
    const data = tabCategories.get(tabId);
    if (data && (data.category === "Movie Streaming" || data.category === "Comic/Manga")) {
      return true;
    }
  }

  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    const keywords = [
      "phim", "chill", "hay", "tv", "vtv", "anime", "cliptv", "fptplay", 
      "vieon", "mot", "sub", "vietsub", "movie", "movies", "hd", "stream", 
      "manga", "comic", "truyen", "torrent"
    ];
    return keywords.some(kw => host.includes(kw));
  } catch {
    return false;
  }
}

function isAdPattern(urlStr: string): boolean {
  const urlLower = urlStr.toLowerCase();
  const adKeywords = [
    "rg.pro.vn", "bboocclink", "154.82.109.", "adcenter", "vsbet", 
    "colatv", "8svui", "i9.top", "betting", "casino", "nhacai",
    "affiliate", "promos", "redirect", "sponsored", "adserver",
    "advert", "popup", "clickunder", "popunder", "shortlink", "workers.dev",
    "tracking", "tracker", "click?", "/click", "prmtracking",
    "popads", "popcash", "adsterra", "exoclick", "juicyads", "propellerads",
    "doubleclick", "googleads", "taboola", "outbrain", "/ads/", "ad_id", "click_id", "aff_id"
  ];
  return adKeywords.some(kw => urlLower.includes(kw)) || 
         /https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(urlLower);
}

function logAdBlockedInHistory(adUrl: string, pageUrl: string) {
  let domain = "ad redirect";
  try {
    domain = new URL(adUrl).hostname;
  } catch {}
  
  chrome.storage.local.get(["adBlockHistory"], (res) => {
    const history = res.adBlockHistory || [];
    const existingIndex = history.findIndex((h: any) => h.url === adUrl);
    if (existingIndex > -1) {
      history[existingIndex].count = (history[existingIndex].count || 1) + 1;
      history[existingIndex].timestamp = Date.now();
      history[existingIndex].pageUrl = pageUrl;
    } else {
      history.unshift({
        url: adUrl,
        domain: domain,
        pageUrl: pageUrl,
        timestamp: Date.now(),
        count: 1
      });
    }
    if (history.length > 100) {
      history.length = 100;
    }
    chrome.storage.local.set({ adBlockHistory: history });
  });
}

// 1. Close popup tabs to external ad origins
chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  if (details.sourceTabId && details.sourceTabId !== -1) {
    chrome.tabs.get(details.sourceTabId, (sourceTab) => {
      if (chrome.runtime.lastError || !sourceTab || !sourceTab.url) return;
      
      const sourceUrl = sourceTab.url;
      if (sourceUrl.startsWith("chrome://") || sourceUrl.startsWith("chrome-extension://")) return;

      // Close popups if:
      // a) The source is a movie streaming site and the target is different domain (not whitelisted)
      // b) The source is NOT a streaming site, but the target explicitly matches known ad networks
      const shouldBlock = isStreamingOrAdProneSite(sourceUrl, details.sourceTabId)
        ? isExternalAdUrl(details.url, sourceUrl)
        : isAdPattern(details.url);

      if (shouldBlock) {
        console.warn("[AdBlocker] Service worker closed popup redirect tab:", details.url);
        chrome.tabs.remove(details.tabId);
        
        // Update badge count for origin tab
        const currentCount = tabBlockedCounts.get(details.sourceTabId) || 0;
        const newCount = currentCount + 1;
        tabBlockedCounts.set(details.sourceTabId, newCount);
        chrome.action.setBadgeText({ tabId: details.sourceTabId, text: newCount.toString() });
        chrome.action.setBadgeBackgroundColor({ tabId: details.sourceTabId, color: "#ef4444" });
        
        logAdBlockedInHistory(details.url, sourceUrl);
      }
    });
  }
});

// 2. Prevent same-tab redirects to external ad origins
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  
  chrome.tabs.get(details.tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !tab.url) return;
    
    const sourceUrl = tab.url;
    if (sourceUrl.startsWith("chrome://") || sourceUrl.startsWith("chrome-extension://") || sourceUrl === "about:blank") {
      return;
    }

    // Only block same-tab redirects if the source is a streaming site AND the target matches ad patterns
    const shouldBlock = isStreamingOrAdProneSite(sourceUrl, details.tabId) && isAdPattern(details.url);

    if (shouldBlock) {
      console.warn("[AdBlocker] Service worker blocked same-tab ad redirect to:", details.url);
      chrome.tabs.update(details.tabId, { url: sourceUrl });
      
      // Update badge count
      const currentCount = tabBlockedCounts.get(details.tabId) || 0;
      const newCount = currentCount + 1;
      tabBlockedCounts.set(details.tabId, newCount);
      chrome.action.setBadgeText({ tabId: details.tabId, text: newCount.toString() });
      chrome.action.setBadgeBackgroundColor({ tabId: details.tabId, color: "#ef4444" });
      
      logAdBlockedInHistory(details.url, sourceUrl);
    }
  });
});

// 3. AI Visually Classify Website Category on Load Completed
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;
  
  const tabId = details.tabId;
  const url = details.url;
  
  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url === "about:blank") {
    return;
  }

  // Delay slightly to let the page render before capturing
  setTimeout(() => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab || !tab.active || tab.status === "loading") return;

      chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 30 }, async (dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) {
          return;
        }

        try {
          await ensureOffscreenDocument();
          const aiResult = await chrome.runtime.sendMessage({
            type: "clipClassifyWebsite",
            imageDataUrl: dataUrl,
            target: "offscreen",
          });

          if (aiResult?.results && Array.isArray(aiResult.results)) {
            const results = aiResult.results;
            results.sort((a: any, b: any) => b.score - a.score);
            const topMatch = results[0];
            const confidence = Math.round(topMatch.score * 100);

            let category = "General Site";
            if (topMatch.label.includes("streaming")) category = "Movie Streaming";
            else if (topMatch.label.includes("manga") || topMatch.label.includes("comic")) category = "Comic/Manga";
            else if (topMatch.label.includes("news")) category = "News/Articles";
            else if (topMatch.label.includes("programming")) category = "Developer Page";
            else if (topMatch.label.includes("shopping")) category = "E-Commerce";
            else if (topMatch.label.includes("search")) category = "Search Engine";

            console.log(`[AdBlocker] AI Classified tab ${tabId} (${url}) as: ${category} (${confidence}% confidence)`);
            tabCategories.set(tabId, { category, confidence });

            // Push category directly to inject.ts MAIN world context using scripting API
            chrome.scripting.executeScript({
              target: { tabId: tabId },
              func: (cat) => {
                (window as any).__adblockerTabCategory = cat;
                window.dispatchEvent(new CustomEvent("adblockerCategoryUpdated", { detail: cat }));
              },
              args: [category],
              world: "MAIN"
            }).catch((err) => {
              // Ignore errors if the tab is reloaded/closed
            });
          }
        } catch (err) {
          console.error("[AdBlocker] Error in AI website classification:", err);
        }
      });
    });
  }, 1500);
});
