// AI Vision & Heuristic Ad Blocker Content Script
class AdBlockerOverlay {
  constructor() {
    this.processedImages = new WeakSet();
    this.detectedAdsMap = new Map();
    this.autoHideAds = true;
    this.lastRightClickedElement = null;
    this.init();
  }

  async init() {
    this.injectGlobalStyles();
    this.loadSettings();
    this.scanImages();
    this.setupMutationObserver();
    this.initMessageListener();
    this.setupContextMenuTracker();
    this.setupVideoAdSkipper();
  }

  setupContextMenuTracker() {
    document.addEventListener(
      "contextmenu",
      (e) => {
        this.lastRightClickedElement = e.target;
      },
      true
    );
  }

  injectGlobalStyles() {
    if (document.getElementById("webllm-adblocker-style")) return;
    const style = document.createElement("style");
    style.id = "webllm-adblocker-style";
    style.textContent = `
      [data-webllm-ad-hidden="true"],
      [data-webllm-ad-hidden="true"] * {
        display: none !important;
        visibility: hidden !important;
        height: 0 !important;
        max-height: 0 !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  loadSettings() {
    chrome.storage?.sync?.get(["autoHideAds"], (res) => {
      if (res.autoHideAds !== undefined) {
        this.autoHideAds = res.autoHideAds;
      }
    });

    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area === "sync" && changes.autoHideAds) {
        this.autoHideAds = changes.autoHideAds.newValue;
        if (this.autoHideAds) {
          this.scanImages();
        }
      }
    });
  }

  initMessageListener() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "getTabDetectedAds") {
        const adsList = Array.from(this.detectedAdsMap.values()).map((ad) => ({
          id: ad.id,
          url: ad.url,
          domain: ad.domain,
          width: ad.width,
          height: ad.height,
          confidence: ad.confidence,
          method: ad.method,
          reasons: ad.reasons,
          isHidden: ad.isHidden,
        }));
        sendResponse({ success: true, ads: adsList });
        return true;
      }

      if (message.type === "toggleAdVisibility") {
        const adInfo = this.detectedAdsMap.get(message.adId);
        if (adInfo && adInfo.targetElement) {
          if (message.hide) {
            this.hideElement(adInfo.targetElement);
            adInfo.isHidden = true;
          } else {
            this.unhideElement(adInfo.targetElement);
            adInfo.isHidden = false;
          }
          sendResponse({ success: true, isHidden: adInfo.isHidden });
        } else {
          sendResponse({ success: false, error: "Ad element not found" });
        }
        return true;
      }

      if (message.type === "analyzeContextImage") {
        let targetImg = null;
        if (this.lastRightClickedElement && this.lastRightClickedElement.tagName === "IMG") {
          targetImg = this.lastRightClickedElement;
        } else if (message.imageUrl) {
          const imgs = Array.from(document.querySelectorAll("img"));
          targetImg = imgs.find((i) => (i.currentSrc || i.src) === message.imageUrl);
        }

        if (targetImg) {
          this.analyzeImage(targetImg);
        } else if (message.imageUrl) {
          this.analyzeImageUrl(message.imageUrl);
        }
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
    if (el.dataset.webllmOriginalDisplay) {
      el.style.display = el.dataset.webllmOriginalDisplay;
    }
  }

  setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes" && m.attributeName === "style" && m.target) {
          const target = m.target;
          if (target.dataset?.webllmAdHidden === "true") {
            if (target.style.display !== "none" || target.style.visibility !== "hidden") {
              this.hideElement(target);
            }
          }
        }
      }
      this.scanImages();
    });
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
  }

  isAdBannerCandidate(img) {
    const width = img.naturalWidth || img.width || 0;
    const height = img.naturalHeight || img.height || 0;
    const url = (img.currentSrc || img.src || "").toLowerCase();

    if (width > 0 && height > 0) {
      const ratio = width / height;
      const invRatio = height / width;
      if (ratio >= 3.0 || invRatio >= 3.0) return true;

      const iabSizes = [
        [728, 90], [468, 60], [320, 50], [300, 250], [336, 280],
        [120, 600], [160, 600], [300, 600], [970, 90], [970, 250], [300, 100]
      ];
      const isIab = iabSizes.some(([w, h]) => Math.abs(w - width) <= 25 && Math.abs(h - height) <= 20);
      if (isIab) return true;
    }

    const adKeywords = [
      "storage/images/other", "api.mamphim", "banner", "ads", "adserver",
      "vsbet", "colatv", "8svui", "i9.top", "betting", "casino", "nhacai",
      "hoahong", "promotions", "affiliate", "sponsor", "game", "worldcup",
      "eclick", "smartads", "adtima", "static.znews.vn/banner", "adsbyeclick",
      "promo", "quangcao", "qc", "adcenter", "ad-center", "advert", "popup"
    ];
    if (adKeywords.some((kw) => url.includes(kw))) return true;

    // Check if wrapped in a sponsored/nofollow link
    const link = img.closest("a");
    if (link) {
      const rel = (link.getAttribute("rel") || "").toLowerCase();
      if (rel.includes("sponsored") || rel.includes("nofollow")) return true;
    }

    return false;
  }

  isAdIframeCandidate(iframe) {
    const width = iframe.offsetWidth || parseInt(iframe.getAttribute("width") || "0", 10) || 0;
    const height = iframe.offsetHeight || parseInt(iframe.getAttribute("height") || "0", 10) || 0;
    const id = (iframe.id || "").toLowerCase();
    const className = (iframe.className || "").toString().toLowerCase();
    const src = (iframe.src || "").toLowerCase();
    const name = (iframe.name || "").toLowerCase();

    const adIframeKeywords = [
      "vli", "vliifrwrapper", "google_ads", "aswift", "ad-iframe", "ad_iframe",
      "adframe", "banner", "taboola", "outbrain", "ezoic", "doubleclick",
      "adservice", "adserver", "pubads", "amazon-ads", "criteo", "popads",
      "mgid", "exoclick", "propeller", "juicyads", "adscatfish", "sspp", "z2-vli",
      "eclick", "smartads", "adsbyeclick", "adnzone", "adxzone", "adx", "admicro",
      "ssppage", "sspbid", "tvcpzone", "admrick", "mediumiframe", "populartooth",
      "lura.", "contineljs", "adn", "sponsor", "ssppagebid", "admsticky"
    ];

    const matchesKeyword = adIframeKeywords.some(
      (kw) => id.includes(kw) || className.includes(kw) || src.includes(kw) || name.includes(kw)
    );

    if (matchesKeyword) return true;

    // Check parent ancestors (up to 4 levels) for ad network markers or data attributes
    let parent = iframe.parentElement;
    for (let i = 0; i < 4 && parent && parent !== document.body; i++) {
      const pId = (parent.id || "").toLowerCase();
      const pCls = (parent.className || "").toString().toLowerCase();
      const pDataSsp = (parent.getAttribute("data-ssp") || "").toLowerCase();
      const pDataAdm = (parent.getAttribute("data-admssprqid") || "").toLowerCase();

      if (
        pDataSsp || pDataAdm ||
        adIframeKeywords.some((kw) => pId.includes(kw) || pCls.includes(kw)) ||
        pCls.includes("banner0") || pId.includes("advzone") || pId.includes("adm")
      ) {
        return true;
      }
      parent = parent.parentElement;
    }

    // Exclude legitimate non-ad video/map embeds
    const nonAdDomains = ["youtube.com", "youtu.be", "vimeo.com", "google.com/maps", "openstreetmap.org", "player.vimeo.com"];
    if (nonAdDomains.some((domain) => src.includes(domain))) {
      return false;
    }

    if (width > 0 && height > 0) {
      const ratio = width / height;
      const invRatio = height / width;
      if (ratio >= 3.0 || invRatio >= 3.0) return true;

      const iabSizes = [
        [728, 90], [468, 60], [320, 50], [300, 250], [336, 280],
        [120, 600], [160, 600], [300, 600], [970, 90], [970, 250], [300, 280],
        [300, 604], [475, 325]
      ];
      const isIab = iabSizes.some(([w, h]) => Math.abs(w - width) <= 25 && Math.abs(h - height) <= 20);
      if (isIab) return true;
    }

    return false;
  }

  scanIframes() {
    if (!this.autoHideAds) return;

    const iframes = Array.from(document.querySelectorAll("iframe"));
    iframes.forEach((iframe) => {
      if (this.processedImages.has(iframe)) return;

      if (this.isAdIframeCandidate(iframe)) {
        this.processedImages.add(iframe);
        this.hideAdIframe(iframe);
      }
    });
  }

  hideAdIframe(iframe) {
    // Target the iframe directly to avoid hiding outer page containers safely
    const targetElement = iframe;
    if (targetElement.dataset.webllmAdHidden === "true") return;

    const originalDisplay = targetElement.style.display || "";
    targetElement.dataset.webllmOriginalDisplay = originalDisplay;
    this.hideElement(targetElement);

    if (iframe.parentElement) {
      const adLogos = iframe.parentElement.querySelectorAll('a[href*="admicro"], [class*="admLogo"], .txtlogo');
      adLogos.forEach((logo) => this.hideElement(logo));
    }

    const adId = iframe.dataset.webllmAdId || "iframe_" + Math.random().toString(36).substr(2, 9);
    iframe.dataset.webllmAdId = adId;

    const width = iframe.offsetWidth || parseInt(iframe.getAttribute("width") || "0", 10) || 300;
    const height = iframe.offsetHeight || parseInt(iframe.getAttribute("height") || "0", 10) || 250;
    const src = iframe.src || iframe.id || "Ad Iframe";
    let domain = "ad network iframe";
    try {
      if (iframe.src && !iframe.src.startsWith("javascript:")) {
        domain = new URL(iframe.src).hostname;
      } else if (iframe.id) {
        domain = iframe.id.split("_")[0];
      }
    } catch {}

    const adInfo = {
      id: adId,
      url: src,
      domain: domain || "iframe ad",
      width,
      height,
      confidence: 95,
      method: "Iframe Ad Network Detector",
      reasons: [`Ad Iframe detected (${iframe.id || iframe.className || "ad-frame"})`],
      isHidden: true,
      targetElement,
      imgElement: iframe,
      originalDisplay,
    };

    this.detectedAdsMap.set(adId, adInfo);
    chrome.runtime.sendMessage({ type: "adBlocked" });
  }

  scanImages() {
    this.scanIframes();
    const images = Array.from(document.querySelectorAll("img"));
    images.forEach((img) => {
      if (this.processedImages.has(img)) return;

      const checkAndProcess = () => {
        if (!this.isAdBannerCandidate(img)) return;

        this.processedImages.add(img);

        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;

        if (this.autoHideAds) {
          const imgSrc = img.currentSrc || img.src;

          let linkUrl = "";
          let linkRel = "";
          const link = img.closest("a");
          if (link) {
            linkUrl = link.href || "";
            linkRel = link.getAttribute("rel") || "";
          }

          let hasCloseAdButton = false;
          let currEl = img;
          for (let i = 0; i < 4 && currEl && currEl.parentElement; i++) {
            const parent = currEl.parentElement;
            const closeBtn = parent.querySelector(
              "button, [role='button'], .close-it, .close-ad, .close_not_qc, " +
              "[class*='close-ad'], [class*='ad-close'], .no-ads-under, " +
              "[aria-label*='quảng cáo'], [aria-label*='Đóng']"
            );
            if (closeBtn) {
              const btnText = (closeBtn.innerText || closeBtn.textContent || "").toLowerCase();
              const ariaLabel = (closeBtn.getAttribute("aria-label") || "").toLowerCase();
              if (
                btnText.includes("qc") || btnText.includes("quảng cáo") || btnText.includes("close") || btnText.includes("đóng") ||
                ariaLabel.includes("qc") || ariaLabel.includes("quảng cáo") || ariaLabel.includes("close") || ariaLabel.includes("đóng") ||
                closeBtn.classList.contains("no-ads-under")
              ) {
                hasCloseAdButton = true;
                break;
              }
            }
            currEl = parent;
          }

          chrome.runtime.sendMessage(
            {
              type: "detectAd",
              imageUrl: imgSrc,
              width,
              height,
              linkUrl,
              linkRel,
              hasCloseAdButton,
            },
            (res) => {
              if (res?.isAd && res.confidence >= 50) {
                this.hideAd(img, res);
                this.cleanupEmptyAdContainers();
              }
            }
          );
        }
      };

      if (img.complete) {
        checkAndProcess();
      } else {
        img.addEventListener("load", checkAndProcess, { once: true });
      }
    });

    this.cleanupEmptyAdContainers();
  }

  getAdTargetContainer(img) {
    let curr = img;

    // Check if the image is inside a fixed/absolute screen-blocking popup overlay
    for (let i = 0; i < 8 && curr && curr.parentElement && curr.parentElement !== document.body; i++) {
      const parent = curr.parentElement;
      const cls = (parent.className || "").toString().toLowerCase();
      const style = window.getComputedStyle(parent);
      if (
        cls.includes("fixed") ||
        cls.includes("modal") ||
        cls.includes("popup") ||
        cls.includes("overlay") ||
        style.position === "fixed" ||
        (style.position === "absolute" && parseInt(style.zIndex, 10) >= 999)
      ) {
        return parent;
      }
      curr = parent;
    }

    // For standard page ads, return the img element itself to be extremely safe
    return img;
  }

  cleanupEmptyAdContainers() {
    if (!this.autoHideAds) return;

    const selector = `
      section.banner-ads, section.section-ads-top, .znews-banner, .z2-VLi-zone,
      .sspp-area, .adscatfish-container, [id*="supper_masthead"], [id*="ZingNews_"],
      [class*="banner-ads"], [class*="section-ads"], [class*="banner-top"],
      .custom-ad-eclick, .eclick_ad_holder, [id*="eclick"], [class*="eclick"],
      ins.adsbyeclick, #boxTinTaiTro, .wrapper-sticky, .item-ads-v25, .item-ads-v16,
      .slide-shopping-ads-viewport, .box-shopping-ads
    `;
    const containers = Array.from(document.querySelectorAll(selector));

    containers.forEach((container) => {
      if (container.dataset.webllmAdHidden === "true") return;

      const imgs = Array.from(container.querySelectorAll("img"));
      if (imgs.length === 0) return;

      const visibleMedia = imgs.filter((media) => {
        const style = window.getComputedStyle(media);
        return style.display !== "none" && style.visibility !== "hidden" && media.offsetWidth > 0;
      });

      if (visibleMedia.length === 0) {
        this.hideElement(container);
      }
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
    try {
      domain = new URL(url).hostname;
    } catch {
      domain = "unknown";
    }

    const adInfo = {
      id: adId,
      url,
      domain,
      width,
      height,
      confidence: res.confidence,
      method: res.method,
      reasons: res.reasons,
      isHidden: true,
      targetElement,
      imgElement: img,
      originalDisplay,
    };

    this.detectedAdsMap.set(adId, adInfo);
    chrome.runtime.sendMessage({ type: "adBlocked" });
  }

  async analyzeImage(img) {
    try {
      const imgSrc = img.currentSrc || img.src;
      const width = img.naturalWidth || img.width || 300;
      const height = img.naturalHeight || img.height || 250;

      let linkUrl = "";
      let linkRel = "";
      const link = img.closest("a");
      if (link) {
        linkUrl = link.href || "";
        linkRel = link.getAttribute("rel") || "";
      }

      let hasCloseAdButton = false;
      let currEl = img;
      for (let i = 0; i < 4 && currEl && currEl.parentElement; i++) {
        const parent = currEl.parentElement;
        const closeBtn = parent.querySelector(
          "button, [role='button'], .close-it, .close-ad, .close_not_qc, " +
          "[class*='close-ad'], [class*='ad-close'], .no-ads-under, " +
          "[aria-label*='quảng cáo'], [aria-label*='Đóng']"
        );
        if (closeBtn) {
          const btnText = (closeBtn.innerText || closeBtn.textContent || "").toLowerCase();
          const ariaLabel = (closeBtn.getAttribute("aria-label") || "").toLowerCase();
          if (
            btnText.includes("qc") || btnText.includes("quảng cáo") || btnText.includes("close") || btnText.includes("đóng") ||
            ariaLabel.includes("qc") || ariaLabel.includes("quảng cáo") || ariaLabel.includes("close") || ariaLabel.includes("đóng") ||
            closeBtn.classList.contains("no-ads-under")
          ) {
            hasCloseAdButton = true;
            break;
          }
        }
        currEl = parent;
      }

      let imageDataUrl = "";
      try {
        const fetchRes = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { type: "fetchImageAsBase64", url: imgSrc },
            (response) => resolve(response)
          );
        });
        if (fetchRes?.base64) {
          imageDataUrl = fetchRes.base64;
        }
      } catch (err) {
        console.warn("[AdBlocker] Failed to fetch base64:", err);
      }

      chrome.runtime.sendMessage(
        {
          type: "detectAd",
          imageUrl: imgSrc,
          imageDataUrl,
          width,
          height,
          linkUrl,
          linkRel,
          hasCloseAdButton,
          forceAI: true,
        },
        (res) => {
          if (res?.success) {
            if (res.isAd && img) {
              this.hideAd(img, res);
            }
            this.showResultModal(img, res);
          } else {
            alert("Detection Error: " + (res?.error || "Unknown error"));
          }
        }
      );
    } catch (err) {
      alert("Error analyzing image: " + err);
    }
  }

  async analyzeImageUrl(imageUrl) {
    try {
      let imageDataUrl = "";
      try {
        const fetchRes = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { type: "fetchImageAsBase64", url: imageUrl },
            (response) => resolve(response)
          );
        });
        if (fetchRes?.base64) {
          imageDataUrl = fetchRes.base64;
        }
      } catch (err) {
        console.warn("[AdBlocker] Failed to fetch base64:", err);
      }

      chrome.runtime.sendMessage(
        {
          type: "detectAd",
          imageUrl: imageUrl,
          imageDataUrl,
          width: 300,
          height: 250,
          forceAI: true,
        },
        (res) => {
          if (res?.success) {
            this.showResultModal(null, res);
          } else {
            alert("Detection Error: " + (res?.error || "Unknown error"));
          }
        }
      );
    } catch (err) {
      alert("Error analyzing image: " + err);
    }
  }

  showResultModal(img, res) {
    const existing = document.getElementById("webllm-ad-modal");
    if (existing) existing.remove();

    let targetElement = null;
    let isHidden = false;
    if (img && img.tagName) {
      targetElement = this.getAdTargetContainer(img);
      isHidden = targetElement.dataset.webllmAdHidden === "true" || targetElement.style.display === "none";
    }

    const modal = document.createElement("div");
    modal.id = "webllm-ad-modal";
    Object.assign(modal.style, {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      zIndex: "2147483647",
      backgroundColor: "#0f172a",
      color: "#f8fafc",
      padding: "24px",
      borderRadius: "16px",
      boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
      fontFamily: "system-ui, -apple-system, sans-serif",
      maxWidth: "420px",
      width: "90%",
      border: "1px solid #334155",
    });

    const titleColor = res.isAd ? "#ef4444" : "#10b981";
    const statusIcon = res.isAd ? "🚨" : "✅";
    const statusText = res.isAd ? "Ad Detected" : "Clean Image";

    modal.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h3 style="margin: 0; font-size: 18px; color: ${titleColor}; display: flex; align-items: center; gap: 8px;">
          ${statusIcon} ${statusText} (${res.confidence}% confidence)
        </h3>
        <button id="webllm-close-modal" style="background: none; border: none; color: #94a3b8; font-size: 20px; cursor: pointer;">&times;</button>
      </div>
      
      <div style="font-size: 13px; color: #cbd5e1; margin-bottom: 16px;">
        <strong>Detection Method:</strong> ${res.method || "Heuristics Engine"}
      </div>

      <div style="background-color: #1e293b; padding: 12px; border-radius: 8px; font-size: 13px; margin-bottom: 20px;">
        <div style="font-weight: 600; margin-bottom: 6px; color: #94a3b8;">Detection Reasons:</div>
        <ul style="margin: 0; padding-left: 18px; color: #e2e8f0;">
          ${(res.reasons || []).map((r) => `<li style="margin-bottom: 4px;">${r}</li>`).join("")}
        </ul>
      </div>

      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        ${
          targetElement
            ? `<button id="webllm-toggle-hide" style="padding: 8px 16px; border-radius: 8px; border: none; font-weight: 600; cursor: pointer; background-color: ${
                isHidden ? "#3b82f6" : "#dc2626"
              }; color: white;">
                ${isHidden ? "Unhide Container" : "Hide Container"}
              </button>`
            : ""
        }
        <button id="webllm-dismiss-modal" style="padding: 8px 16px; border-radius: 8px; border: 1px solid #475569; background: #334155; color: white; cursor: pointer;">Close</button>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById("webllm-close-modal").onclick = () => modal.remove();
    document.getElementById("webllm-dismiss-modal").onclick = () => modal.remove();

    const toggleBtn = document.getElementById("webllm-toggle-hide");
    if (toggleBtn && targetElement) {
      toggleBtn.onclick = () => {
        if (isHidden) {
          this.unhideElement(targetElement);
        } else {
          this.hideElement(targetElement);
        }
        modal.remove();
      };
    }
  }

  setupVideoAdSkipper() {
    setInterval(() => {
      this.scanVideoAds();
      this.scanClickjackingOverlays();
    }, 500);
  }

  scanVideoAds() {
    const videos = Array.from(document.querySelectorAll("video"));
    if (videos.length === 0) return;

    const isElementVisible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    };

    // Find any skip ad button on the page
    const buttons = Array.from(document.querySelectorAll("button, div, span, a"));
    
    const isSkipButton = (el) => {
      if (el.children.length > 3) return false;
      if (!isElementVisible(el)) return false;
      
      const text = (el.innerText || el.textContent || "").trim().toLowerCase();
      const cls = (el.className || "").toString().toLowerCase();
      const id = (el.id || "").toString().toLowerCase();
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();

      const isMatchText = 
        text === "bỏ qua" || 
        text === "skip" || 
        text.includes("bỏ qua quảng cáo") || 
        text.includes("bỏ qua qc") || 
        text.includes("skip ad") || 
        text.includes("skip_ad") || 
        text.includes("skip ad button") ||
        aria.includes("bỏ qua") ||
        aria.includes("skip");

      const isMatchClass = 
        cls.includes("skip-ad") || 
        cls.includes("ad-skip") || 
        cls.includes("skip-button") || 
        cls.includes("skipqc") || 
        cls.includes("btn-skip") || 
        cls.includes("jw-skip") ||
        cls.includes("vjs-skip") ||
        id.includes("skip-ad") || 
        id.includes("ad-skip") || 
        id.includes("skip-button");

      return isMatchText || isMatchClass;
    };

    const skipBtn = buttons.find(isSkipButton);

    if (skipBtn) {
      // Find the playing video element
      const activeVideo = videos.find(v => !v.paused) || videos[0];
      
      if (activeVideo) {
        // 1. Mute the video
        if (!activeVideo.muted) {
          activeVideo.muted = true;
          activeVideo.dataset.webllmAutoMuted = "true";
        }

        // 2. Show black cover overlay
        this.showVideoAdCover(activeVideo);

        // 3. Auto-click if skip is ready (no countdown digits)
        const btnText = (skipBtn.innerText || skipBtn.textContent || "").trim();
        const hasCountdown = /\d+\s*(s|giây| giây)/i.test(btnText) || 
                            (skipBtn.disabled) || 
                            (skipBtn.getAttribute("disabled") !== null) ||
                            (skipBtn.className || "").toString().toLowerCase().includes("disabled");

        if (!hasCountdown) {
          console.log("[AdBlocker] Clickable skip button found! Auto-skipping video ad.");
          skipBtn.click();
          
          try {
            skipBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
          } catch (e) {}

          // Remove cover and unmute immediately
          this.removeVideoAdCover(activeVideo);
          if (activeVideo.dataset.webllmAutoMuted === "true") {
            activeVideo.muted = false;
            delete activeVideo.dataset.webllmAutoMuted;
          }
        }
      }
    } else {
      // No skip ad button present on page, clean up covers and unmute if we auto-muted
      videos.forEach(video => {
        this.removeVideoAdCover(video);
        if (video.dataset.webllmAutoMuted === "true") {
          video.muted = false;
          delete video.dataset.webllmAutoMuted;
        }
      });
    }
  }

  showVideoAdCover(videoEl) {
    const parent = videoEl.parentElement;
    if (!parent) return;

    if (parent.querySelector("#webllm-video-ad-cover")) return;

    const cover = document.createElement("div");
    cover.id = "webllm-video-ad-cover";
    Object.assign(cover.style, {
      position: "absolute",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      backgroundColor: "#000000",
      zIndex: "2147483645",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      color: "#ffffff",
      fontFamily: "system-ui, -apple-system, sans-serif",
      fontSize: "16px",
      fontWeight: "bold",
      pointerEvents: "none",
    });

    cover.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; padding: 20px;">
        <svg style="width: 48px; height: 48px; fill: #ef4444; animation: webllm-pulse 1.5s infinite;" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
        </svg>
        <span style="font-size: 15px; color: #f8fafc;">🛡️ AI Vision Ad Blocker</span>
        <span style="font-size: 12px; font-weight: normal; color: #94a3b8;">Muting and skipping video advertisement...</span>
      </div>
      <style>
        @keyframes webllm-pulse {
          0% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.1); opacity: 0.7; }
          100% { transform: scale(1); opacity: 1; }
        }
      </style>
    `;

    const parentStyle = window.getComputedStyle(parent);
    if (parentStyle.position === "static") {
      parent.style.position = "relative";
    }
    parent.appendChild(cover);
  }

  removeVideoAdCover(videoEl) {
    const parent = videoEl.parentElement;
    if (parent) {
      const cover = parent.querySelector("#webllm-video-ad-cover");
      if (cover) cover.remove();
    }
  }

  scanClickjackingOverlays() {
    const divs = Array.from(document.querySelectorAll("div, a, iframe, ins"));
    const viewWidth = window.innerWidth;
    const viewHeight = window.innerHeight;

    divs.forEach((el) => {
      if (el.dataset.webllmClickjacker === "processed") return;

      const style = window.getComputedStyle(el);
      
      const isPositioned = style.position === "fixed" || style.position === "absolute";
      if (!isPositioned) return;

      const zIndex = parseInt(style.zIndex, 10);
      if (isNaN(zIndex) || zIndex < 999) return;

      const rect = el.getBoundingClientRect();
      const coversWidth = rect.width >= viewWidth * 0.85;
      const coversHeight = rect.height >= viewHeight * 0.85;
      if (!coversWidth || !coversHeight) return;

      const isBgTransparent = 
        style.backgroundColor === "transparent" || 
        style.backgroundColor.includes("rgba(0, 0, 0, 0)") || 
        style.backgroundColor.includes("rgba(255, 255, 255, 0)") ||
        style.backgroundColor === "initial" ||
        style.backgroundColor === "";
        
      const isOpacityZero = parseFloat(style.opacity || "1") < 0.1;
      const isTransparent = isBgTransparent || isOpacityZero;
      if (!isTransparent) return;

      if (style.pointerEvents === "none") return;

      const text = (el.innerText || el.textContent || "").trim();
      if (text.length > 30) return;

      const interactiveChildren = el.querySelectorAll("input, button, select, textarea, form, a[href]");
      if (interactiveChildren.length > 2) return;

      console.warn("[AdBlocker] Detected transparent clickjacking overlay:", el);
      el.dataset.webllmClickjacker = "processed";
      
      el.style.setProperty("pointer-events", "none", "important");
      
      try {
        el.remove();
        console.log("[AdBlocker] Removed clickjacking overlay from DOM.");
      } catch (e) {
        el.style.setProperty("display", "none", "important");
      }
    });
  }
}

new AdBlockerOverlay();
