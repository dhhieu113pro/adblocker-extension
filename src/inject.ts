(function() {
  const adKeywords = [
    "rg.pro.vn", "bboocclink", "154.82.109.", "adcenter", "vsbet", 
    "colatv", "8svui", "i9.top", "betting", "casino", "nhacai",
    "affiliate", "promos", "redirect", "sponsored", "adserver",
    "advert", "popup", "clickunder", "popunder", "shortlink", "workers.dev"
  ];

  const isAdUrl = (url: any): boolean => {
    if (!url) return false;
    const lowerUrl = url.toString().toLowerCase();
    
    // Check keywords
    if (adKeywords.some(kw => lowerUrl.includes(kw))) return true;
    
    // Check raw IP addresses
    if (/https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(lowerUrl)) return true;
    
    return false;
  };

  const isExternalAdUrl = (url: any): boolean => {
    if (!url) return false;
    try {
      const targetUrl = new URL(url.toString(), window.location.href);
      const targetHost = targetUrl.hostname.toLowerCase();
      const currentHost = window.location.hostname.toLowerCase();
      
      // Ignore relative paths or local origins
      if (!targetHost || targetHost === currentHost || targetHost.endsWith("." + currentHost)) {
        return false;
      }
      
      // Whitelist of common auth and legitimate sharing platforms
      const whitelist = [
        "google.com", "facebook.com", "github.com", "twitter.com", 
        "apple.com", "microsoft.com", "youtube.com", "vimeo.com", 
        "imdb.com", "wikipedia.org"
      ];
      if (whitelist.some(domain => targetHost === domain || targetHost.endsWith("." + domain))) {
        return false;
      }

      return true; // External origin popup is blocked!
    } catch {
      return false; // Fallback on parse errors
    }
  };

  // Hook window.open and return Proxy to catch blank window locations
  const originalOpen = window.open;
  (window as any).open = function(url?: string | URL, target?: string, features?: string) {
    const urlStr = url ? url.toString() : "";
    if (urlStr && (isAdUrl(urlStr) || isExternalAdUrl(urlStr))) {
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
                if (val && (isAdUrl(val) || isExternalAdUrl(val))) {
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
          if (prop === "location" && val && (isAdUrl(val) || isExternalAdUrl(val))) {
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

  // Intercept click hijacking via dynamic link clicks (capturing phase)
  window.addEventListener("click", (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target) return;

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

    const link = target.closest("a");
    if (link) {
      const href = link.href || "";
      // Block standard ad URLs
      if (isAdUrl(href)) {
        console.warn("[AdBlocker] Hook blocked click redirection to:", href);
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

      // Block programmatic (untrusted) clicks going to external origins
      if (!e.isTrusted && isExternalAdUrl(href)) {
        console.warn("[AdBlocker] Hook blocked untrusted programmatic click redirection to:", href);
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }
  }, true);
})();
