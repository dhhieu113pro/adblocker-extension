import { isAdUrl as sharedIsAdUrl, isStreamingKeywordSite, isLocalDevelopmentUrl } from "./shared";

(function() {
  if ((window as any).__aiVisionAdBlockerMainInitialized) return;
  (window as any).__aiVisionAdBlockerMainInitialized = true;
  let fullProtectionEnabled = true;

  // Wrappers bind page context (relative URL resolution / current page host)
    const isAdUrl = (rawUrl: any, aggressive = false): boolean =>
      sharedIsAdUrl(rawUrl, window.location.href, aggressive);

  let tabCategory = "General Site";
  let siteBlockingEnabled = true;
  try {
    chrome.storage.sync.get(["disabledSites"], (res) => {
      siteBlockingEnabled = !(res.disabledSites || []).includes(window.location.hostname.toLowerCase());
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.disabledSites) {
        siteBlockingEnabled = !(changes.disabledSites.newValue || []).includes(window.location.hostname.toLowerCase());
      }
    });
  } catch {}
  if ((window as any).__adblockerTabCategory) {
    tabCategory = (window as any).__adblockerTabCategory;
  }
  window.addEventListener("adblockerCategoryUpdated", (e: any) => {
    tabCategory = e.detail;
    console.log("[AdBlocker] main-world script updated tab category to:", tabCategory);
  });

  const isStreamingOrAdProneSite = (urlStr: string): boolean => {
    if (!siteBlockingEnabled) return false;
    if (isLocalDevelopmentUrl(urlStr)) return false;
    if (tabCategory === "Movie Streaming" || tabCategory === "Comic/Manga") {
      return true;
    }
    return isStreamingKeywordSite(urlStr);
  };

  // Helper to determine if we should block the target popup URL based on context
  const shouldBlockRedirect = (targetUrl: string): boolean => {
    if (!fullProtectionEnabled) return false;
    const isStreaming = isStreamingOrAdProneSite(window.location.href);
    // If it's a streaming site, strictly block any external URL (except whitelist/same-brand)
    // If it's a normal site, only block if the target URL explicitly matches known ad domains
    return isStreaming && isAdUrl(targetUrl, true);
  };

  // Hook window.open and return Proxy to catch blank window locations
  const originalOpen = window.open;
  const handleFullProtectionState = (event: any) => {
    fullProtectionEnabled = event.detail !== false;
    if (fullProtectionEnabled) return;

    try {
      Object.defineProperty(window, "open", {
        value: originalOpen,
        writable: true,
        configurable: true,
      });
    } catch {}
    (window as any).__aiVisionAdBlockerMainInitialized = false;
    window.removeEventListener("aiVisionFullProtectionState", handleFullProtectionState);
  };
  window.addEventListener("aiVisionFullProtectionState", handleFullProtectionState);

  const myOpen = function(url?: string | URL, target?: string, features?: string) {
    const urlStr = url ? url.toString() : "";
    if (urlStr && shouldBlockRedirect(urlStr)) {
      console.warn("[AdBlocker] Hook blocked window.open popup redirect to:", urlStr);
      return null;
    }

    const newWin = originalOpen.apply(this, arguments as any);
    if (!newWin) return newWin;

    try {
      // Intercept dynamic writes to location (e.g. win.location = adUrl or win.location.href = adUrl)
      return new Proxy(newWin, {
        get(targetObj, prop) {
          if (prop === "location") {
            return new Proxy(targetObj.location, {
              set(locTarget, locProp, val) {
                if (val && shouldBlockRedirect(val)) {
                  console.warn("[AdBlocker] Blocked location write on opened window to:", val);
                  return true;
                }
                (locTarget as any)[locProp] = val;
                return true;
              }
            });
          }
          const val = (targetObj as any)[prop];
          if (typeof val === "function") {
            return val.bind(targetObj);
          }
          return val;
        },
        set(targetObj, prop, val) {
          if (prop === "location" && val && shouldBlockRedirect(val)) {
            console.warn("[AdBlocker] Blocked location assignment on opened window to:", val);
            return true;
          }
          (targetObj as any)[prop] = val;
          return true;
        }
      });
    } catch (e) {
      return newWin;
    }
  };

  // Lock window.open with a getter/setter to prevent page scripts from overriding it
  try {
    Object.defineProperty(window, "open", {
      get() {
        return myOpen;
      },
      set(val) {
        console.warn("[AdBlocker] Intercepted and rejected website attempt to override window.open.");
      },
      configurable: true
    });
  } catch (e) {
    // Fallback if defineProperty fails (e.g. already locked)
    (window as any).open = myOpen;
  }

  // Intercept click hijacking via dynamic link clicks (capturing phase)
  window.addEventListener("click", (e: MouseEvent) => {
    if (!fullProtectionEnabled) return;
    if (isLocalDevelopmentUrl(window.location.href)) return;
    const target = e.target as HTMLElement;
    if (!target) return;

    const isStreaming = isStreamingOrAdProneSite(window.location.href);

    // Only apply clickjacking overlay detection on movie/streaming sites to prevent breaking legitimate modals on normal sites
    if (isStreaming) {
      // Check if the clicked element (or its near parents) is a transparent clickjacking overlay
      let curr: HTMLElement | null = target;
      for (let i = 0; i < 3 && curr && curr !== document.body; i++) {
        try {
          const style = window.getComputedStyle(curr);
          const isPositioned = style.position === "fixed" || style.position === "absolute";
          const zIndex = parseInt(style.zIndex, 10);
          
          const rect = curr.getBoundingClientRect();
          const viewWidth = window.innerWidth;
          const viewHeight = window.innerHeight;
          const coversScreen = rect.width >= viewWidth * 0.8 && rect.height >= viewHeight * 0.8;
          
          const isBgTransparent = 
            style.backgroundColor === "transparent" || 
            style.backgroundColor.includes("rgba(0, 0, 0, 0)") || 
            style.backgroundColor.includes("rgba(255, 255, 255, 0)") ||
            style.backgroundColor === "initial" ||
            style.backgroundColor === "";
          const isOpacityZero = parseFloat(style.opacity || "1") < 0.1;
          const isTransparent = isBgTransparent || isOpacityZero;

          const text = (curr.innerText || curr.textContent || "").trim();
          const hasNoContent = text.length < 30;

          if (isPositioned && !isNaN(zIndex) && zIndex >= 999 && coversScreen && isTransparent && hasNoContent) {
            console.warn("[AdBlocker] Capturing click blocked on clickjacking overlay:", curr);
            e.preventDefault();
            e.stopPropagation();
            
            try {
              curr.remove();
            } catch {}
            
            return false;
          }
        } catch (err) {}
        curr = curr.parentElement;
      }
    }

    const link = target.closest("a");
    if (link) {
      const href = link.href || "";
      // Block standard ad URLs on all sites (heuristics only on streaming/ad-prone sites)
      if (isStreaming && isAdUrl(href, true)) {
        console.warn("[AdBlocker] Hook blocked click redirection to:", href);
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

      // Block programmatic (untrusted) clicks going to external origins
      // On streaming sites, check strict non-origin block. On normal sites, check keyword list block.
      const shouldBlockUntrusted = isAdUrl(href, isStreaming);

      if (!e.isTrusted && shouldBlockUntrusted) {
        console.warn("[AdBlocker] Hook blocked untrusted programmatic click redirection to:", href);
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }
  }, true);
})();
