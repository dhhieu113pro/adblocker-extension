// AI Vision & Heuristic Ad Blocker Content Script
import { isHardAdNetwork, AD_CONTAINER_SELECTORS, loadRemoteAdRules } from "./shared";
import { shouldRemoveTransparentAdOverlay } from "./transparent-ad-overlay-policy.mjs";
import { shouldAutoAnalyzeImageCandidate, shouldBlockDetectionResult } from "./image-ad-policy.mjs";

class AdBlockerOverlay {
  constructor() {
    this.processedImages = new WeakSet();
    this.processedImageUrls = new WeakMap();
    this.currentPageUrl = window.location.href;
    this.detectedAdsMap = new Map();
    this.autoHideAds = true;
    this.siteDisabled = false;
    this.allowedAds = new Set();
    this.lastRightClickedElement = null;
    this.adCheckQueue = [];
    this.adCheckWorkers = 0;
    this.maxConcurrentAdChecks = 3;
    this.adCheckUrls = new Set();
    this.protectionGeneration = 0;
    this.scanTimer = null;
    this.jwMutedVideos = new Map();
    this.jwSkipTimer = null;
    this.jwClickedButtons = new WeakSet();
    this.init();
  }

  async init() {
    this.injectGlobalStyles();
    await this.loadSettings();
    this.setupMutationObserver();
    this.setupNavigationTracking();
    this.initMessageListener();
    this.setupContextMenuTracker();
    this.setupJwAdSkipAutomation();
    this.scanImages();
    this.scanVideos();
    loadRemoteAdRules().then(() => {
      if (!this.autoHideAds || this.siteDisabled) return;
      this.processedImages = new WeakSet();
      this.processedImageUrls = new WeakMap();
      this.scheduleScan();
    });
    setInterval(() => this.scanClickjackingOverlays(), 1000);
  }

  setupContextMenuTracker() {
    document.addEventListener("contextmenu", (e) => { this.lastRightClickedElement = e.target; }, true);
  }

  injectGlobalStyles() {
    if (document.getElementById("webllm-adblocker-style")) return;
    const style = document.createElement("style");
    style.id = "webllm-adblocker-style";
    style.textContent = `[data-webllm-ad-hidden="true"],[data-webllm-ad-hidden="true"] *{display:none!important;visibility:hidden!important;height:0!important;max-height:0!important;min-height:0!important;margin:0!important;padding:0!important;opacity:0!important;pointer-events:none!important}`;
    (document.head || document.documentElement).appendChild(style);
  }

  async loadSettings() {
    try {
      const site = window.location.hostname.toLowerCase();
      const res = await chrome.storage?.sync?.get(["autoHideAds", "disabledSites", "allowedAds"]);
      if (res?.autoHideAds !== undefined) this.autoHideAds = res.autoHideAds;
      this.siteDisabled = Array.isArray(res?.disabledSites) && res.disabledSites.includes(site);
      this.allowedAds = new Set(Array.isArray(res?.allowedAds) ? res.allowedAds : []);
    } catch (err) { console.warn("[AdBlocker] Failed to load settings:", err); }
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area === "sync" && changes.autoHideAds) {
        this.autoHideAds = changes.autoHideAds.newValue;
        if (this.autoHideAds) {
          this.processedImages = new WeakSet();
          this.processedImageUrls = new WeakMap();
          this.scheduleScan();
        } else {
          this.disableSiteBlocking();
        }
      }
      if (area === "sync" && changes.disabledSites) {
        const disabled = (changes.disabledSites.newValue || []).includes(window.location.hostname.toLowerCase());
        this.siteDisabled = disabled;
        if (disabled) this.disableSiteBlocking();
        else { this.processedImages = new WeakSet(); this.processedImageUrls = new WeakMap(); this.scheduleScan(); }
      }
      if (area === "sync" && changes.allowedAds) this.allowedAds = new Set(changes.allowedAds.newValue || []);
    });
  }

  disableSiteBlocking() {
    this.protectionGeneration += 1;
    this.restoreJwMutedVideos();
    document.querySelectorAll('[data-webllm-ad-hidden="true"]').forEach((element) => this.unhideElement(element));
    this.detectedAdsMap.clear();
    this.adCheckQueue = [];
    this.adCheckUrls.clear();
    this.processedImages = new WeakSet();
    this.processedImageUrls = new WeakMap();
  }

  scheduleScan() {
    if (this.scanTimer) return;
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null;
      if (this.autoHideAds && !this.siteDisabled) { this.scanImages(); this.scanVideos(); }
    }, 150);
  }

  restoreJwMutedVideos() {
    this.jwMutedVideos.forEach((state, video) => {
      if (!video.isConnected) return;
      video.muted = state.muted;
      video.volume = state.volume;
    });
    this.jwMutedVideos.clear();
  }

  setupJwAdSkipAutomation() {
    const run = () => this.handleJwAdSkip();
    this.jwSkipTimer = setInterval(run, 250);
    run();
  }

  handleJwAdSkip() {
    if (!this.autoHideAds || this.siteDisabled) return;
    const skipButtons = Array.from(document.querySelectorAll(".jw-skip[role='button'], .jw-skip"));
    const countdownButton = skipButtons.find((button) => {
      const label = (button.getAttribute("aria-label") || button.textContent || "").toLowerCase();
      return label.includes("bỏ qua quảng cáo sau") || label.includes("skip ad in");
    });
    if (countdownButton) {
      document.querySelectorAll("video").forEach((video) => {
        if (!this.jwMutedVideos.has(video)) this.jwMutedVideos.set(video, { muted: video.muted, volume: video.volume });
        video.muted = true;
      });
      return;
    }
    const readyButton = skipButtons.find((button) => {
      const label = (button.getAttribute("aria-label") || "").toLowerCase();
      const text = (button.textContent || "").trim().toLowerCase();
      return button.classList.contains("jw-skippable") && (label === "bỏ qua" || label === "skip ad" || label === "skip" || text === "bỏ qua" || text === "skip ad" || text === "skip");
    });
    if (!readyButton || this.jwClickedButtons.has(readyButton)) return;
    this.jwClickedButtons.add(readyButton);
    readyButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    readyButton.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    readyButton.click();
    window.setTimeout(() => this.restoreJwMutedVideos(), 150);
  }

  initMessageListener() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "fullProtectionDisabled") {
        this.siteDisabled = true;
        this.disableSiteBlocking();
        window.dispatchEvent(new CustomEvent("aiVisionFullProtectionState", { detail: false }));
        sendResponse({ success: true });
        return true;
      }
      if (message.type === "fullProtectionEnabled") {
        chrome.storage.sync.get(["disabledSites"], (res) => {
          const site = window.location.hostname.toLowerCase();
          this.siteDisabled = Array.isArray(res.disabledSites) && res.disabledSites.includes(site);
          window.dispatchEvent(new CustomEvent("aiVisionFullProtectionState", { detail: true }));
          if (!this.siteDisabled) {
            this.processedImages = new WeakSet();
            this.processedImageUrls = new WeakMap();
            this.scheduleScan();
          }
          sendResponse({ success: true, enabled: !this.siteDisabled });
        });
        return true;
      }
      if (message.type === "getTabDetectedAds") {
        const adsList = Array.from(this.detectedAdsMap.values()).map((ad) => ({ id: ad.id, url: ad.url, domain: ad.domain, width: ad.width, height: ad.height, confidence: ad.confidence, method: ad.method, reasons: ad.reasons, isHidden: ad.isHidden }));
        sendResponse({ success: true, ads: adsList });
        return true;
      }
      if (message.type === "toggleAdVisibility") {
        const adInfo = this.detectedAdsMap.get(message.adId);
        if (adInfo && adInfo.targetElement) {
          const adUrl = adInfo.url || "";
          if (message.hide) { this.allowedAds.delete(adUrl); this.hideElement(adInfo.targetElement); adInfo.isHidden = true; }
          else { this.allowedAds.add(adUrl); this.unhideElement(adInfo.targetElement); adInfo.isHidden = false; }
          chrome.storage.sync.set({ allowedAds: Array.from(this.allowedAds) });
          sendResponse({ success: true, isHidden: adInfo.isHidden });
        } else sendResponse({ success: false, error: "Ad element not found" });
        return true;
      }
      if (message.type === "analyzeContextImage") {
        let targetImg = null;
        if (this.lastRightClickedElement && this.lastRightClickedElement.tagName === "IMG") targetImg = this.lastRightClickedElement;
        else if (message.imageUrl) targetImg = Array.from(document.querySelectorAll("img")).find((i) => (i.currentSrc || i.src) === message.imageUrl);
        if (targetImg) this.analyzeImage(targetImg);
        else if (message.imageUrl) this.analyzeImageUrl(message.imageUrl);
        return true;
      }
      return false;
    });
  }

  hideElement(el) {
    if (!el) return;
    el.dataset.webllmAdHidden = "true";
    el.style.setProperty("display", "none", "important");
    el.style.setProperty("visibility", "hidden", "important");
    el.style.setProperty("height", "0px", "important");
  }

  unhideElement(el) {
    if (!el) return;
    delete el.dataset.webllmAdHidden;
    el.style.removeProperty("display");
    el.style.removeProperty("visibility");
    el.style.removeProperty("height");
    if (el.dataset.webllmOriginalDisplay) el.style.display = el.dataset.webllmOriginalDisplay;
  }

  handlePageNavigation() {
    const nextUrl = window.location.href;
    if (nextUrl === this.currentPageUrl) return;
    this.currentPageUrl = nextUrl;
    this.protectionGeneration += 1;
    this.detectedAdsMap.clear();
    this.adCheckQueue = [];
    this.adCheckUrls.clear();
    this.processedImages = new WeakSet();
    this.processedImageUrls = new WeakMap();
    if (!this.autoHideAds || this.siteDisabled) return;
    this.scanImages();
    this.scanVideos();
  }

  setupNavigationTracking() {
    const originalPushState = history.pushState.bind(history);
    history.pushState = (...args) => {
      const result = originalPushState(...args);
      queueMicrotask(() => this.handlePageNavigation());
      return result;
    };
    const originalReplaceState = history.replaceState.bind(history);
    history.replaceState = (...args) => {
      const result = originalReplaceState(...args);
      queueMicrotask(() => this.handlePageNavigation());
      return result;
    };
    window.addEventListener("popstate", () => queueMicrotask(() => this.handlePageNavigation()));
    window.addEventListener("hashchange", () => queueMicrotask(() => this.handlePageNavigation()));
  }

  setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      if (window.location.href !== this.currentPageUrl) this.handlePageNavigation();
      let hasNewNodes = false;
      let hasImageSourceChange = false;
      for (const m of mutations) {
        if (m.type === "childList" && m.addedNodes.length > 0) hasNewNodes = true;
        if (m.type === "attributes" && m.target?.tagName === "IMG" && ["src", "data-src", "data-lazy-src"].includes(m.attributeName)) hasImageSourceChange = true;
        if (m.type === "attributes" && m.attributeName === "style" && m.target) {
          const target = m.target;
          if (target.dataset?.webllmAdHidden === "true" && (target.style.display !== "none" || target.style.visibility !== "hidden")) this.hideElement(target);
        }
      }
      if (hasNewNodes) this.scanClickjackingOverlays();
      if (hasNewNodes) this.scanKnownAdSlots();
      if (hasImageSourceChange) this.scanImages();
      this.scheduleScan();
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "src", "data-src", "data-lazy-src"] });
  }

  scanKnownAdSlots() {
    if (!this.autoHideAds || this.siteDisabled) return;
    const slots = document.querySelectorAll(AD_CONTAINER_SELECTORS.join(", ") + ', [id^="adbro"], [class^="adbro-"]');
    slots.forEach((slot) => {
      if (slot.dataset.webllmAdHidden === "true") return;
      const id = (slot.id || "").toLowerCase();
      const className = (slot.className || "").toString().toLowerCase();
      if (id === "adbro" || id.startsWith("adbro-")) { this.hideElement(slot); return; }
      if (className.startsWith("adbro-") && slot.closest("#adbro")) return;
      const image = slot.querySelector("img");
      if (image) {
        const src = image.currentSrc || image.src || image.getAttribute("data-src") || "";
        if (src && !this.allowedAds.has(src)) this.hideAd(image, { isAd: true, confidence: 99, method: "Known ad slot detector", reasons: ["Known ad banner container"] });
      }
    });
  }

  shouldAnalyzeImage(img) {
    const width = parseInt(img.getAttribute("width") || "0", 10) || img.naturalWidth || img.width || 0;
    const height = parseInt(img.getAttribute("height") || "0", 10) || img.naturalHeight || img.height || 0;
    const url = img.currentSrc || img.src || "";
    const alt = img.alt || "";
    const parentClasses = img.closest("header, nav, .logo, .logo-brand, #nav")?.className?.toString() || "";
    const linkRel = img.closest("a")?.getAttribute("rel") || "";
    return shouldAutoAnalyzeImageCandidate({ width, height, url, alt, parentClasses, linkRel });
  }

  isAdIframeCandidate(iframe) {
    const width = iframe.offsetWidth || parseInt(iframe.getAttribute("width") || "0", 10) || 0;
    const height = iframe.offsetHeight || parseInt(iframe.getAttribute("height") || "0", 10) || 0;
    const id = (iframe.id || "").toLowerCase();
    const className = (iframe.className || "").toString().toLowerCase();
    const src = (iframe.src || "").toLowerCase();
    const name = (iframe.name || "").toLowerCase();
    const adIframeKeywords = ["vli","vliifrwrapper","google_ads","aswift","ad-iframe","ad_iframe","adframe","banner","taboola","outbrain","ezoic","doubleclick","adservice","adserver","pubads","amazon-ads","criteo","popads","mgid","exoclick","propeller","juicyads","adscatfish","sspp","z2-vli","eclick","smartads","adsbyeclick","adnzone","adxzone","adx","admicro","ssppage","sspbid","tvcpzone","admrick","mediumiframe","populartooth","lura.","contineljs","adn","sponsor","ssppagebid","admsticky"];
    if (adIframeKeywords.some((kw) => id.includes(kw) || className.includes(kw) || src.includes(kw) || name.includes(kw))) return true;
    let parent = iframe.parentElement;
    for (let i = 0; i < 4 && parent && parent !== document.body; i++) {
      const pId = (parent.id || "").toLowerCase();
      const pCls = (parent.className || "").toString().toLowerCase();
      const pDataSsp = (parent.getAttribute("data-ssp") || "").toLowerCase();
      const pDataAdm = (parent.getAttribute("data-admssprqid") || "").toLowerCase();
      if (pDataSsp || pDataAdm || adIframeKeywords.some((kw) => pId.includes(kw) || pCls.includes(kw)) || pCls.includes("banner0") || pId.includes("advzone") || pId.includes("adm")) return true;
      parent = parent.parentElement;
    }
    const nonAdDomains = ["youtube.com", "youtu.be", "vimeo.com", "google.com/maps", "openstreetmap.org", "player.vimeo.com"];
    if (nonAdDomains.some((domain) => src.includes(domain))) return false;
    if (width > 0 && height > 0) {
      const ratio = width / height;
      const invRatio = height / width;
      if (ratio >= 3.0 || invRatio >= 3.0) return true;
    }
    return false;
  }

  scanIframes() {
    if (!this.autoHideAds || this.siteDisabled) return;
    Array.from(document.querySelectorAll("iframe")).forEach((iframe) => {
      if (this.processedImages.has(iframe)) return;
      if (this.isAdIframeCandidate(iframe)) { this.processedImages.add(iframe); this.hideAdIframe(iframe); }
    });
  }

  scanVideos() {
    if (!this.autoHideAds || this.siteDisabled) return;
    this.scanPlayStreamAdLayers();
    document.querySelectorAll("video").forEach((video) => {
      if (this.processedImages.has(video)) return;
      const title = (video.getAttribute("title") || "").toLowerCase();
      const src = (video.currentSrc || video.src || "").toLowerCase();
      if (title.includes("advertisement") || title.includes("quảng cáo") || title.includes("qc")) {
        if (this.allowedAds.has(video.currentSrc || video.src)) return;
        this.processedImages.add(video); this.hideAdVideo(video, "Video title indicates advertisement"); return;
      }
      if (isHardAdNetwork(src)) {
        if (this.allowedAds.has(src)) return;
        this.processedImages.add(video); this.hideAdVideo(video, "Video served from ad network"); return;
      }
      let parent = video;
      for (let i = 0; i < 4 && parent && parent !== document.body; i++) {
        const pId = (parent.id || "").toLowerCase();
        const pCls = (parent.className || "").toString().toLowerCase();
        if (/(playstream|adnzone|admzone|sspp)/.test(pId + " " + pCls) && !pId.startsWith("ps-video-slot")) {
          this.processedImages.add(video); this.hideAdVideo(video, `Video inside ad container (${parent.id || pCls})`, parent); return;
        }
        parent = parent.parentElement;
      }
    });
  }

  scanPlayStreamAdLayers() {
    document.querySelectorAll('[id^="ps-ad-player-player-container"], [id^="ps-ad-player-display-container"], [id^="ps-ad-player-controller"], iframe[title="Advertisement"]').forEach((layer) => {
      if (layer.dataset.webllmAdHidden === "true") return;
      this.hideElement(layer);
      layer.dataset.webllmAdHidden = "true";
    });
  }

  hideAdVideo(video, reason, explicitContainer) {
    const targetElement = explicitContainer || this.getAdTargetContainer(video);
    if (targetElement.dataset.webllmAdHidden === "true") return;
    const originalDisplay = targetElement.style.display || "";
    targetElement.dataset.webllmOriginalDisplay = originalDisplay;
    this.hideElement(targetElement);
    try { video.pause(); } catch {}
    const adId = video.dataset.webllmAdId || "ad_" + Math.random().toString(36).substr(2, 9);
    video.dataset.webllmAdId = adId;
    this.detectedAdsMap.set(adId, { id: adId, url: video.currentSrc || video.src || "Ad Video", domain: "ad video", width: video.videoWidth || 0, height: video.videoHeight || 0, confidence: 95, method: "Auto video ad detection", reasons: [reason], isHidden: true, targetElement, imgElement: video, originalDisplay });
    chrome.runtime.sendMessage({ type: "adBlocked", adUrl: video.currentSrc || video.src, adDomain: "ad video", pageUrl: window.location.href });
  }

  hideAdIframe(iframe) {
    const targetElement = iframe;
    if (targetElement.dataset.webllmAdHidden === "true") return;
    const originalDisplay = targetElement.style.display || "";
    targetElement.dataset.webllmOriginalDisplay = originalDisplay;
    this.hideElement(targetElement);
    if (iframe.parentElement) iframe.parentElement.querySelectorAll('a[href*="admicro"], [class*="admLogo"], .txtlogo').forEach((logo) => this.hideElement(logo));
    const adId = iframe.dataset.webllmAdId || "iframe_" + Math.random().toString(36).substr(2, 9);
    iframe.dataset.webllmAdId = adId;
    const width = iframe.offsetWidth || parseInt(iframe.getAttribute("width") || "0", 10) || 300;
    const height = iframe.offsetHeight || parseInt(iframe.getAttribute("height") || "0", 10) || 250;
    const src = iframe.src || iframe.id || "Ad Iframe";
    let domain = "ad network iframe";
    try { if (iframe.src && !iframe.src.startsWith("javascript:")) domain = new URL(iframe.src).hostname; else if (iframe.id) domain = iframe.id.split("_")[0]; } catch {}
    this.detectedAdsMap.set(adId, { id: adId, url: src, domain: domain || "iframe ad", width, height, confidence: 95, method: "Iframe Ad Network Detector", reasons: [`Ad Iframe detected (${iframe.id || iframe.className || "ad-frame"})`], isHidden: true, targetElement, imgElement: iframe, originalDisplay });
    chrome.runtime.sendMessage({ type: "adBlocked", adUrl: src, adDomain: domain || "iframe ad", pageUrl: window.location.href });
  }

  getImageSource(img) {
    return img.currentSrc || img.src || img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || "";
  }

  scanImages() {
    if (this.siteDisabled) return;
    this.scanIframes();
    this.scanKnownAdSlots();
    Array.from(document.querySelectorAll("img")).forEach((img) => {
      const initialSrc = this.getImageSource(img);
      if (this.processedImageUrls.get(img) === initialSrc) return;
      const checkAndProcess = () => {
        const imgSrc = this.getImageSource(img);
        if (this.processedImageUrls.get(img) === imgSrc) return;
        if (!this.shouldAnalyzeImage(img)) return;
        this.processedImageUrls.set(img, imgSrc);
        if (!this.autoHideAds) return;
        const width = parseInt(img.getAttribute("width") || "0", 10) || img.naturalWidth || img.width || 0;
        const height = parseInt(img.getAttribute("height") || "0", 10) || img.naturalHeight || img.height || 0;
        if (isHardAdNetwork(imgSrc)) {
          let host = "ad network";
          try { host = new URL(imgSrc).hostname; } catch {}
          this.hideAd(img, { isAd: true, confidence: 95, method: "Known ad network", reasons: [`Ad network URL (${host})`] });
          this.cleanupEmptyAdContainers();
          return;
        }
        let linkUrl = "";
        let linkRel = "";
        const link = img.closest("a");
        if (link) { linkUrl = link.href || ""; linkRel = link.getAttribute("rel") || ""; }
        let hasCloseAdButton = false;
        let currEl = img;
        for (let i = 0; i < 4 && currEl && currEl.parentElement; i++) {
          const parent = currEl.parentElement;
          const closeBtn = parent.querySelector(".close-it, .close-ad, .close_not_qc, [class*='close-ad'], [class*='ad-close'], .no-ads-under, [aria-label*='quảng cáo'], [aria-label*='advertisement'], [aria-label*='ad close']");
          if (closeBtn) {
            const btnText = (closeBtn.innerText || closeBtn.textContent || "").toLowerCase();
            const ariaLabel = (closeBtn.getAttribute("aria-label") || "").toLowerCase();
            const className = (closeBtn.className || "").toString().toLowerCase();
            if (btnText.includes("qc") || btnText.includes("quảng cáo") || btnText.includes("advertisement") || ariaLabel.includes("qc") || ariaLabel.includes("quảng cáo") || ariaLabel.includes("advertisement") || ariaLabel.includes("ad close") || className.includes("close-ad") || className.includes("ad-close") || className.includes("no-ads")) { hasCloseAdButton = true; break; }
          }
          currEl = parent;
        }
        this.enqueueAdCheck(img, { imageUrl: imgSrc, width, height, linkUrl, linkRel, hasCloseAdButton });
      };
      // Use src + declared dimensions immediately so known ads can be hidden
      // before their pixels finish loading. Retry after load only when the early
      // pass did not identify this image as a candidate.
      checkAndProcess();
      if (!img.complete && this.processedImageUrls.get(img) !== this.getImageSource(img)) {
        img.addEventListener("load", checkAndProcess, { once: true });
      }
    });
    this.cleanupEmptyAdContainers();
  }

  enqueueAdCheck(img, msg) {
    if (!msg.imageUrl || this.allowedAds.has(msg.imageUrl) || this.adCheckUrls.has(msg.imageUrl)) return;
    this.adCheckUrls.add(msg.imageUrl);
    this.adCheckQueue.push({ img, msg });
    this.processAdCheckQueue();
  }

  async fetchImageDataUrl(imageUrl) {
    try {
      const fetchRes = await new Promise((resolve) => { chrome.runtime.sendMessage({ type: "fetchImageAsBase64", url: imageUrl }, (response) => resolve(response)); });
      return fetchRes?.base64 || "";
    } catch (err) { console.warn("[AdBlocker] Failed to fetch image for AI classification:", err); return ""; }
  }

  requestAdDecision(payload) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "detectAd", ...payload }, (res) => resolve(res));
    });
  }

  processAdCheckQueue() {
    while (this.adCheckWorkers < this.maxConcurrentAdChecks && this.adCheckQueue.length > 0) {
      const item = this.adCheckQueue.shift();
      this.adCheckWorkers += 1;
      this.processAdCheck(item).finally(() => {
        this.adCheckWorkers -= 1;
        this.adCheckUrls.delete(item.msg.imageUrl);
        this.processAdCheckQueue();
      });
    }
  }

  async processAdCheck({ img, msg }) {
    const generation = this.protectionGeneration;
    if (!img?.isConnected || this.getImageSource(img) !== msg.imageUrl) return;

    const preflight = await this.requestAdDecision({ ...msg, preflightOnly: true });
    if (generation !== this.protectionGeneration || !this.autoHideAds || this.siteDisabled || !img?.isConnected || this.getImageSource(img) !== msg.imageUrl) return;
    if (shouldBlockDetectionResult(preflight)) {
      this.hideAd(img, preflight);
      this.cleanupEmptyAdContainers();
      return;
    }
    if (!preflight?.needsImageData) return;

    const imageDataUrl = await this.fetchImageDataUrl(msg.imageUrl);
    if (!imageDataUrl || generation !== this.protectionGeneration || !this.autoHideAds || this.siteDisabled || !img?.isConnected) return;

    const result = await this.requestAdDecision({ ...msg, imageDataUrl });
    if (generation === this.protectionGeneration && this.autoHideAds && !this.siteDisabled && shouldBlockDetectionResult(result) && img?.isConnected && this.getImageSource(img) === msg.imageUrl) {
      this.hideAd(img, result);
      this.cleanupEmptyAdContainers();
    }
  }

  getAdTargetContainer(img) {
    let curr = img;
    for (let i = 0; i < 8 && curr && curr.parentElement && curr.parentElement !== document.body; i++) {
      const parent = curr.parentElement;
      const cls = (parent.className || "").toString().toLowerCase();
      const id = (parent.id || "").toLowerCase();
      if (parent.matches?.("header, nav") || id === "nav" || /(^|[-_ ])(header|navigation|nav)([-_ ]|$)/.test(cls)) { curr = parent; continue; }
      const style = window.getComputedStyle(parent);
      const isScreenOverlay = style.position === "fixed" || (style.position === "absolute" && parseInt(style.zIndex, 10) >= 999);
      const marker = `${id} ${cls}`;
      const hasExplicitAdMarker = /(^|[-_ ])(ad|ads|advert|advertisement|banner|sponsor|promo|quangcao|qc)([-_ ]|$)/.test(marker);
      if (isScreenOverlay && hasExplicitAdMarker) return parent;
      curr = parent;
    }
    curr = img;
    for (let i = 0; i < 6 && curr && curr.parentElement && curr.parentElement !== document.body; i++) {
      const parent = curr.parentElement;
      const id = (parent.id || "").toLowerCase();
      const cls = (parent.className || "").toLowerCase();
      if (id.includes("placement-") || id.includes("banner-") || id.includes("zone-") || id.includes("adnzone") || id.includes("admzone") || cls.includes("banner-ads") || cls.includes("eclick_ad_holder") || cls.includes("ad-item")) return parent;
      curr = parent;
    }
    if (img.parentElement && img.parentElement.tagName === "A") return img.parentElement;
    return img;
  }

  cleanupEmptyAdContainers() {
    if (!this.autoHideAds) return;
    const selector = `section.banner-ads, section.section-ads-top, .znews-banner, .z2-VLi-zone, .sspp-area, .adscatfish-container, [id*="supper_masthead"], [id*="ZingNews_"], [class*="banner-ads"], [class*="section-ads"], [class*="banner-top"], .custom-ad-eclick, .eclick_ad_holder, [id*="eclick"], [class*="eclick"], ins.adsbyeclick, #boxTinTaiTro, .wrapper-sticky, .item-ads-v25, .item-ads-v16, .slide-shopping-ads-viewport, .box-shopping-ads, [id*="adnzone"], [id*="admzone"], [id*="placement-"], [class*="admLogo"], .txtlogo`;
    Array.from(document.querySelectorAll(selector)).forEach((container) => {
      if (container.dataset.webllmAdHidden === "true") return;
      const imgs = Array.from(container.querySelectorAll("img"));
      if (imgs.length === 0) return;
      const visibleMedia = imgs.filter((media) => { const style = window.getComputedStyle(media); return style.display !== "none" && style.visibility !== "hidden" && media.offsetWidth > 0; });
      if (visibleMedia.length === 0) this.hideElement(container);
    });
  }

  hideAd(img, res) {
    const targetElement = this.getAdTargetContainer(img);
    if (targetElement.dataset.webllmAdHidden === "true") return;
    const originalDisplay = targetElement.style.display || "";
    targetElement.dataset.webllmOriginalDisplay = originalDisplay;
    this.hideElement(targetElement);
    if (img.parentElement) {
      const closeBtn = img.parentElement.querySelector(".close-it, .close-ad, .close_not_qc, [class*='close-ad'], [class*='ad-close']");
      if (closeBtn) this.hideElement(closeBtn);
    }
    const adId = img.dataset.webllmAdId || "ad_" + Math.random().toString(36).substr(2, 9);
    img.dataset.webllmAdId = adId;
    const width = img.width || img.naturalWidth;
    const height = img.height || img.naturalHeight;
    const url = img.currentSrc || img.src;
    let domain = "";
    try { domain = new URL(url).hostname; } catch { domain = "unknown"; }
    this.detectedAdsMap.set(adId, { id: adId, url, domain, width, height, confidence: res.confidence, method: res.method, reasons: res.reasons, isHidden: true, targetElement, imgElement: img, originalDisplay });
    chrome.runtime.sendMessage({ type: "adBlocked", adUrl: url, adDomain: domain, pageUrl: window.location.href });
  }

  async analyzeImage(img) {
    try {
      const imgSrc = img.currentSrc || img.src;
      let linkUrl = "";
      let linkRel = "";
      const link = img.closest("a");
      if (link) { linkUrl = link.href || ""; linkRel = link.getAttribute("rel") || ""; }
      let hasCloseAdButton = false;
      let currEl = img;
      for (let i = 0; i < 4 && currEl && currEl.parentElement; i++) {
        const parent = currEl.parentElement;
        const closeBtn = parent.querySelector(".close-it, .close-ad, .close_not_qc, [class*='close-ad'], [class*='ad-close'], .no-ads-under, [aria-label*='quảng cáo'], [aria-label*='advertisement'], [aria-label*='ad close']");
        if (closeBtn) {
          const btnText = (closeBtn.innerText || closeBtn.textContent || "").toLowerCase();
          const ariaLabel = (closeBtn.getAttribute("aria-label") || "").toLowerCase();
          const className = (closeBtn.className || "").toString().toLowerCase();
          if (btnText.includes("qc") || btnText.includes("quảng cáo") || btnText.includes("advertisement") || ariaLabel.includes("qc") || ariaLabel.includes("quảng cáo") || ariaLabel.includes("advertisement") || ariaLabel.includes("ad close") || className.includes("close-ad") || className.includes("ad-close") || className.includes("no-ads")) { hasCloseAdButton = true; break; }
        }
        currEl = parent;
      }
      const imageDataUrl = await this.fetchImageDataUrl(imgSrc);
      // Manual checks also avoid dimensions so CLIP decides from pixels, not shape.
      chrome.runtime.sendMessage({ type: "detectAd", imageUrl: imgSrc, imageDataUrl, linkUrl, linkRel, hasCloseAdButton, forceAI: true }, (res) => {
        if (res?.success) {
          if (res.isAd && img) this.hideAd(img, res);
          this.showResultModal(img, res);
        } else alert("Detection Error: " + (res?.error || "Unknown error"));
      });
    } catch (err) { alert("Error analyzing image: " + err); }
  }

  async analyzeImageUrl(imageUrl) {
    try {
      const imageDataUrl = await this.fetchImageDataUrl(imageUrl);
      chrome.runtime.sendMessage({ type: "detectAd", imageUrl, imageDataUrl, forceAI: true }, (res) => {
        if (res?.success) this.showResultModal(null, res);
        else alert("Detection Error: " + (res?.error || "Unknown error"));
      });
    } catch (err) { alert("Error analyzing image: " + err); }
  }

  showResultModal(img, res) {
    const existing = document.getElementById("webllm-ad-modal");
    if (existing) existing.remove();
    let targetElement = null;
    let isHidden = false;
    if (img && img.tagName) { targetElement = this.getAdTargetContainer(img); isHidden = targetElement.dataset.webllmAdHidden === "true" || targetElement.style.display === "none"; }
    const modal = document.createElement("div");
    modal.id = "webllm-ad-modal";
    Object.assign(modal.style, { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: "2147483647", backgroundColor: "#0f172a", color: "#f8fafc", padding: "24px", borderRadius: "16px", boxShadow: "0 25px 50px -12px rgba(0,0,0,.7)", fontFamily: "system-ui,-apple-system,sans-serif", maxWidth: "420px", width: "90%", border: "1px solid #334155" });
    const titleColor = res.isAd ? "#ef4444" : "#10b981";
    const statusIcon = res.isAd ? "🚨" : "✅";
    const statusText = res.isAd ? "Ad Detected" : "Clean Image";
    modal.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="margin:0;font-size:18px;color:${titleColor};display:flex;align-items:center;gap:8px">${statusIcon} ${statusText} (${res.confidence}% confidence)</h3><button id="webllm-close-modal" style="background:none;border:none;color:#94a3b8;font-size:20px;cursor:pointer">&times;</button></div><div style="font-size:13px;color:#cbd5e1;margin-bottom:16px"><strong>Detection Method:</strong> ${res.method || "Heuristics Engine"}</div><div style="background-color:#1e293b;padding:12px;border-radius:8px;font-size:13px;margin-bottom:20px"><div style="font-weight:600;margin-bottom:6px;color:#94a3b8">Detection Reasons:</div><ul style="margin:0;padding-left:18px;color:#e2e8f0">${(res.reasons || []).map((r) => `<li style="margin-bottom:4px">${r}</li>`).join("")}</ul></div><div style="display:flex;gap:12px;justify-content:flex-end">${targetElement ? `<button id="webllm-toggle-hide" style="padding:8px 16px;border-radius:8px;border:none;font-weight:600;cursor:pointer;background-color:${isHidden ? "#3b82f6" : "#dc2626"};color:white">${isHidden ? "Unhide Container" : "Hide Container"}</button>` : ""}<button id="webllm-dismiss-modal" style="padding:8px 16px;border-radius:8px;border:1px solid #475569;background:#334155;color:white;cursor:pointer">Close</button></div>`;
    document.body.appendChild(modal);
    document.getElementById("webllm-close-modal").onclick = () => modal.remove();
    document.getElementById("webllm-dismiss-modal").onclick = () => modal.remove();
    const toggleBtn = document.getElementById("webllm-toggle-hide");
    if (toggleBtn && targetElement) toggleBtn.onclick = () => { if (isHidden) this.unhideElement(targetElement); else this.hideElement(targetElement); modal.remove(); };
  }

  scanClickjackingOverlays() {
    if (!this.autoHideAds || this.siteDisabled) return;
    const divs = Array.from(document.querySelectorAll("div, a, iframe, ins"));
    const viewWidth = window.innerWidth;
    const viewHeight = window.innerHeight;
    divs.forEach((el) => {
      if (el.dataset.webllmClickjacker === "processed") return;
      const style = window.getComputedStyle(el);
      if (style.position !== "fixed" && style.position !== "absolute") return;
      const zIndex = parseInt(style.zIndex, 10);
      if (isNaN(zIndex) || zIndex < 999) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < viewWidth * 0.85 || rect.height < viewHeight * 0.85) return;
      const isBgTransparent = style.backgroundColor === "transparent" || style.backgroundColor.includes("rgba(0, 0, 0, 0)") || style.backgroundColor.includes("rgba(255, 255, 255, 0)") || style.backgroundColor === "initial" || style.backgroundColor === "";
      if (!(isBgTransparent || parseFloat(style.opacity || "1") < 0.1) || style.pointerEvents === "none") return;
      const text = (el.innerText || el.textContent || "").trim();
      if (text.length > 30) return;
      const interactiveDescendantCount = el.querySelectorAll("input, button, select, textarea, form, a[href]").length;
      if (interactiveDescendantCount > 2) return;
      if (!shouldRemoveTransparentAdOverlay({
        id: el.id || "",
        className: (el.className || "").toString(),
        position: style.position,
        zIndex,
        width: rect.width,
        height: rect.height,
        viewWidth,
        viewHeight,
        backgroundColor: style.backgroundColor,
        opacity: parseFloat(style.opacity || "1"),
        pointerEvents: style.pointerEvents,
        textLength: text.length,
        interactiveDescendantCount,
      })) return;
      console.debug("[AdBlocker] Detected transparent ad overlay:", el);
      el.dataset.webllmClickjacker = "processed";
      el.style.setProperty("pointer-events", "none", "important");
      try { el.remove(); console.debug("[AdBlocker] Removed transparent ad overlay from DOM."); }
      catch (e) { el.style.setProperty("display", "none", "important"); }
    });
  }
}

if (!globalThis.__aiVisionAdBlockerContentInitialized) {
  globalThis.__aiVisionAdBlockerContentInitialized = true;
  new AdBlockerOverlay();
}