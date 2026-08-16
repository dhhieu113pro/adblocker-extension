import { isAdUrl, isExternalAdUrl, isStreamingKeywordSite, isLocalDevelopmentUrl, AD_DOMAINS, loadRemoteAdRules } from "./shared";

const tabBlockedCounts = new Map<number, number>();
const tabCategories = new Map<number, { category: string, confidence: number }>();

// --- Declarative Net Request blocking (#5) ---
const AD_DNR_BASE = 1000;
const DNR_RESOURCE_TYPES: chrome.declarativeNetRequest.ResourceType[] = [
  "main_frame", "sub_frame", "script", "image", "xmlhttprequest",
  "other", "media", "stylesheet", "font", "websocket", "ping",
];

async function setupDnrRules() {
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const existingIds = existing.map((r) => r.id);
    const adDomains = Array.from(AD_DOMAINS);
    const rules = adDomains.map((domain, i) => ({
      id: AD_DNR_BASE + i,
      priority: 1,
      action: { type: "block" as const },
      condition: {
        urlFilter: `||${domain}^`,
        resourceTypes: DNR_RESOURCE_TYPES,
      },
    }));

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingIds,
      addRules: rules,
    });
    console.log(`DNR: ${rules.length} ad-domain block rules installed`);
  } catch (e) {
    console.warn("DNR setup failed:", e);
  }
}

setupDnrRules();
loadRemoteAdRules().then(() => setupDnrRules());

// --- Per-image CLIP result cache (#3) ---
const CLIP_CACHE_KEY = "webllmClipCache";
const CLIP_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CLIP_CACHE_MAX = 500;

let clipCache = new Map<string, { label: string; score: number; aiConfidence: number; isAd: boolean; ts: number }>();
let clipCacheLoaded = false;
let clipCacheLoadPromise: Promise<void> | undefined;
let clipCacheSaveTimer: number | undefined;
const inFlightClassify = new Map<string, Promise<any>>();
const lastCommittedUrls = new Map<number, string>();
const categoryCache = new Map<string, { category: string; confidence: number }>();

async function loadClipCache() {
  if (clipCacheLoaded) return;
  if (clipCacheLoadPromise) return clipCacheLoadPromise;

  clipCacheLoadPromise = (async () => {
  try {
    const data = await chrome.storage.local.get(CLIP_CACHE_KEY);
    if (data && data[CLIP_CACHE_KEY]) {
      clipCache = new Map(Object.entries(data[CLIP_CACHE_KEY]));
    }
  } catch (err) {
    console.warn("[AdBlocker] Failed to load CLIP cache:", err);
  }
  clipCacheLoaded = true;
  })();

  try {
    await clipCacheLoadPromise;
  } finally {
    clipCacheLoadPromise = undefined;
  }
}

function getCachedClip(imageUrl?: string) {
  if (!imageUrl) return undefined;
  const entry = clipCache.get(imageUrl);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CLIP_CACHE_TTL_MS) {
    clipCache.delete(imageUrl);
    return undefined;
  }
  return entry;
}

function setCachedClip(imageUrl: string, entry: { label: string; score: number; aiConfidence: number; isAd: boolean; ts: number }) {
  if (!imageUrl) return;
  if (clipCache.size >= CLIP_CACHE_MAX) {
    let oldestKey = "";
    let oldestTs = Infinity;
    clipCache.forEach((v, k) => { if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; } });
    if (oldestKey) clipCache.delete(oldestKey);
  }
  clipCache.set(imageUrl, entry);
  clearTimeout(clipCacheSaveTimer);
  clipCacheSaveTimer = setTimeout(() => {
    chrome.storage.local.set({ [CLIP_CACHE_KEY]: Object.fromEntries(clipCache) })
      .catch((err) => console.warn("[AdBlocker] Failed to save CLIP cache:", err));
  }, 500);
}

loadClipCache();

// Coalesces concurrent classify calls for the same image and writes the cache.
async function classifyAdWithCache(message: any, heuristics: any) {
  const cacheKey = message.model === "mobilenet" ? "" : message.imageUrl;
  if (cacheKey) {
    const pending = inFlightClassify.get(cacheKey);
    if (pending) return pending;
  }

  const p = chrome.runtime.sendMessage({
    type: "clipClassifyAd",
    imageDataUrl: message.imageDataUrl,
    model: message.model,
    target: "offscreen",
  }).then((res: any) => {
    if (res?.results && Array.isArray(res.results) && res.results.length > 0 && cacheKey) {
      const top = res.results[0];
      const aiConfidence = Math.round(top.score * 100);
      const isAdFromAI = top.label.includes("advertisement") || top.label.includes("banner");
      setCachedClip(cacheKey, {
        label: top.label,
        score: top.score,
        aiConfidence: Math.max(aiConfidence, heuristics.confidence),
        isAd: isAdFromAI || heuristics.isAd,
        ts: Date.now(),
      });
    }
    return res;
  }).catch(() => undefined);

  if (cacheKey) {
    inFlightClassify.set(cacheKey, p);
    p.then(() => inFlightClassify.delete(cacheKey));
  }
  return p;
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) lastCommittedUrls.set(tabId, changeInfo.url);
  if (changeInfo.status === "loading") {
    tabBlockedCounts.set(tabId, 0);
    tabCategories.delete(tabId);
    chrome.action.setBadgeText({ tabId, text: "" });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabBlockedCounts.delete(tabId);
  tabCategories.delete(tabId);
  lastCommittedUrls.delete(tabId);
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
        // The service worker may receive the first page scan before the
        // fire-and-forget startup load above has completed. Always wait for
        // persisted results before deciding to run a new AI classification.
        await loadClipCache();
        const modelSettings = await chrome.storage.sync.get("visionModel");
        const selectedModel = modelSettings.visionModel || "clip";

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
                  // #3 - Serve from cache before touching the ~350MB CLIP model
                  const cached = selectedModel === "clip" ? getCachedClip(message.imageUrl) : undefined;
                  if (cached) {
                    sendResponse({
                      success: true,
                      isAd: cached.isAd,
                      confidence: cached.aiConfidence,
                      method: "CLIP Cache",
                      reasons: [
                        `AI Classification (cached): "${cached.label}" (${cached.aiConfidence}%)`,
                        ...heuristics.reasons,
                      ],
                    });
                    return;
                  }

                  await ensureOffscreenDocument();
                  const aiResult = await classifyAdWithCache({ ...message, model: selectedModel }, heuristics);

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

function isStreamingOrAdProneSite(urlStr: string, tabId?: number): boolean {
  if (isLocalDevelopmentUrl(urlStr)) return false;
  if (tabId !== undefined) {
    const data = tabCategories.get(tabId);
    if (data && (data.category === "Movie Streaming" || data.category === "Comic/Manga")) {
      return true;
    }
  }

  return isStreamingKeywordSite(urlStr);
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

      // Only close popups opened from streaming/ad-prone sites.
      const shouldBlock =
        isStreamingOrAdProneSite(sourceUrl, details.sourceTabId) &&
        isExternalAdUrl(details.url, sourceUrl);

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
    
    const sourceUrl = lastCommittedUrls.get(details.tabId) || tab.url;
    if (sourceUrl.startsWith("chrome://") || sourceUrl.startsWith("chrome-extension://") || sourceUrl === "about:blank") {
      return;
    }

    // Only block same-tab redirects if the source is a streaming site AND the target matches ad patterns
    const shouldBlock = isStreamingOrAdProneSite(sourceUrl, details.tabId) && isAdUrl(details.url, undefined, true);

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

// 3. AI Visually Classify Website Category on Load Completed & Block Ad Popups
chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;
  
  const tabId = details.tabId;
  const url = details.url;
  if (isLocalDevelopmentUrl(url)) return;
  
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

          // A. If the tab has an openerTabId (it is a popup window), check if it is visually a gambling/betting/promotional ad page.
          if (tab.openerTabId) {
            const aiAdResult = await chrome.runtime.sendMessage({
              type: "clipClassifyAdPage",
              imageDataUrl: dataUrl,
              target: "offscreen",
            });

            if (aiAdResult?.results && Array.isArray(aiAdResult.results)) {
              const results = aiAdResult.results;
              results.sort((a: any, b: any) => b.score - a.score);
              const topMatch = results[0];
              const confidence = Math.round(topMatch.score * 100);

              const isAdPage = topMatch.label.includes("betting") || 
                               topMatch.label.includes("casino") || 
                               topMatch.label.includes("promotional");

              if (isAdPage && topMatch.score >= 0.50) {
                console.warn(`[AdBlocker] AI visually identified popup tab ${tabId} as an AD LANDER: "${topMatch.label}" (${confidence}% confidence). Closing tab.`);
                
                // Close the popup tab
                chrome.tabs.remove(tabId);

                // Update badge count of the parent tab
                const parentTabId = tab.openerTabId;
                const currentCount = tabBlockedCounts.get(parentTabId) || 0;
                const newCount = currentCount + 1;
                tabBlockedCounts.set(parentTabId, newCount);
                chrome.action.setBadgeText({ tabId: parentTabId, text: newCount.toString() });
                chrome.action.setBadgeBackgroundColor({ tabId: parentTabId, color: "#ef4444" });

                logAdBlockedInHistory(url, "Popup Ad Page");
                return; // Popup tab closed, terminate chain
              }
            }
          }

          // B. Classify category for general layout
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

            const cachedCategory = categoryCache.get(url);
            let category = cachedCategory?.category || "General Site";
            let finalConfidence = cachedCategory?.confidence || confidence;
            if (!cachedCategory) {
            if (topMatch.label.includes("streaming")) category = "Movie Streaming";
            else if (topMatch.label.includes("manga") || topMatch.label.includes("comic")) category = "Comic/Manga";
            else if (topMatch.label.includes("news")) category = "News/Articles";
            else if (topMatch.label.includes("programming")) category = "Developer Page";
            else if (topMatch.label.includes("shopping")) category = "E-Commerce";
            else if (topMatch.label.includes("search")) category = "Search Engine";
              categoryCache.set(url, { category, confidence });
            }

            console.log(`[AdBlocker] AI Classified tab ${tabId} (${url}) as: ${category} (${finalConfidence}% confidence)`);
            tabCategories.set(tabId, { category, confidence: finalConfidence });

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
