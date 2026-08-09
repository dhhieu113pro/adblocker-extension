(function() {
  // ---------- Known ad / redirect domains ----------
  const adDomains = new Set([
    "doubleclick.net", "googlesyndication.com", "googleadservices.com",
    "adsterra.com", "popads.net", "popcash.net", "exoclick.com",
    "juicyads.com", "propellerads.com", "taboola.com", "outbrain.com",
    "i9.top", "colatv.vn", "vsbet.com", "nhacai.com", "rg.pro.vn"
  ]);

  // ---------- Domains to never flag (CDNs, infra, mainstream sites) ----------
  const trustedDomains = new Set([
    "cloudfront.net", "amazonaws.com", "googleapis.com", "gstatic.com",
    "cloudflare.com", "github.io", "vercel.app", "netlify.app",
    "google.com", "youtube.com", "facebook.com", "wikipedia.org", "github.com"
  ]);

  // ---------- Path / query signatures ----------
  const adPathPatterns = [
    /\/ads?\//i, /\/adserver\//i, /\/popunder/i, /\/clickunder/i,
    /\/sponsored\//i, /\/shortlink\//i, /\/redirect\//i, /\/promos?\//i
  ];

  const adQueryParams = ["ad_id", "click_id", "aff_id", "prmtracking", "utm_source=ad"];

  // ---------- Entropy / randomness helpers ----------
  function calculateEntropy(str: string): number {
    const freq: Record<string, number> = {};
    for (const char of str) freq[char] = (freq[char] || 0) + 1;
    let entropy = 0;
    const len = str.length;
    for (const char in freq) {
      const p = freq[char] / len;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }

  function isHighEntropy(label: string): boolean {
    if (label.length < 6) return false;
    return calculateEntropy(label) > 3.2;
  }

  function looksRandom(label: string): boolean {
    const vowels = (label.match(/[aeiou]/gi) || []).length;
    const digits = (label.match(/[0-9]/g) || []).length;

    if (label.length >= 6 && vowels === 0) return true;           // no vowels at all
    if (/[bcdfghjklmnpqrstvwxyz]{5,}/i.test(label)) return true;  // consonant wall
    if (digits > 0 && label.length <= 10 && digits / label.length > 0.25) return true; // digit-heavy

    return false;
  }

  function isTrustedInfra(hostname: string): boolean {
    return [...trustedDomains].some(d => hostname === d || hostname.endsWith("." + d));
  }

  function hasRandomLookingLabel(hostname: string): boolean {
    if (isTrustedInfra(hostname)) return false;
    const labels = hostname.split(".").filter(l => l.length > 0);
    return labels.some(label => {
      if (label.length < 5) return false;
      return isHighEntropy(label) || looksRandom(label);
    });
  }

  // ---------- Main function ----------
  const isAdUrl = (rawUrl: any): boolean => {
    if (!rawUrl) return false;

    let url: URL;
    try {
      url = new URL(rawUrl.toString(), window.location.href);
    } catch {
      return false; // invalid URL, don't flag
    }

    const hostname = url.hostname.toLowerCase();

    // Never flag trusted infra domains
    if (isTrustedInfra(hostname)) return false;

    // 1. Known ad domain (exact or subdomain match)
    if ([...adDomains].some(d => hostname === d || hostname.endsWith("." + d))) return true;

    // 2. Raw IP host
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;

    // 3. Suspicious path
    if (adPathPatterns.some(re => re.test(url.pathname.toLowerCase()))) return true;

    // 4. Suspicious query params
    if (adQueryParams.some(p => url.search.toLowerCase().includes(p))) return true;

    // 5. Random-looking domain label (DGA-style generated domains)
    if (hasRandomLookingLabel(hostname)) return true;

    return false;
  };

  let tabCategory = "General Site";
  if ((window as any).__adblockerTabCategory) {
    tabCategory = (window as any).__adblockerTabCategory;
  }
  window.addEventListener("adblockerCategoryUpdated", (e: any) => {
    tabCategory = e.detail;
    console.log("[AdBlocker] main-world script updated tab category to:", tabCategory);
  });

  const isStreamingOrAdProneSite = (urlStr: string): boolean => {
    if (tabCategory === "Movie Streaming" || tabCategory === "Comic/Manga") {
      return true;
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
  };

  const getCoreDomain = (host: string): string => {
    const parts = host.toLowerCase().split(".");
    if (parts.length < 2) return host;
    const commonSubTlds = ["com", "co", "net", "org", "gov", "edu"];
    const secondToLast = parts[parts.length - 2];
    if (parts.length >= 3 && commonSubTlds.includes(secondToLast)) {
      return parts[parts.length - 3];
    }
    return secondToLast;
  };

  const isExternalAdUrl = (url: any): boolean => {
    if (!url) return false;
    try {
      const targetUrl = new URL(url.toString(), window.location.href);
      const targetHost = targetUrl.hostname.toLowerCase();
      const currentHost = window.location.hostname.toLowerCase();
      
      // Allow relative paths, same host, or subdomains
      if (!targetHost || targetHost === currentHost || targetHost.endsWith("." + currentHost)) {
        return false;
      }

      // Allow same core brand domain (e.g. phimmoichill.tv on phimmoichill.club)
      if (getCoreDomain(targetHost) === getCoreDomain(currentHost)) {
        return false;
      }

      // Whitelist of safe external domains
      const whitelist = [
        "google.com", "facebook.com", "github.com", "twitter.com", 
        "apple.com", "microsoft.com", "youtube.com", "vimeo.com", 
        "imdb.com", "wikipedia.org", "discord.com", "reddit.com"
      ];
      if (whitelist.some(domain => targetHost === domain || targetHost.endsWith("." + domain))) {
        return false;
      }

      return true; // Different domain & not whitelisted -> Block!
    } catch {
      return true; // Block on parse errors for maximum safety
    }
  };

  // Helper to determine if we should block the target popup URL based on context
  const shouldBlockRedirect = (targetUrl: string): boolean => {
    const isStreaming = isStreamingOrAdProneSite(window.location.href);
    // If it's a streaming site, strictly block any external URL (except whitelist/same-brand)
    // If it's a normal site, only block if the target URL explicitly matches known ad domains
    return isStreaming 
      ? (isAdUrl(targetUrl) || isExternalAdUrl(targetUrl))
      : isAdUrl(targetUrl);
  };

  // Hook window.open and return Proxy to catch blank window locations
  const originalOpen = window.open;
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
      configurable: false
    });
  } catch (e) {
    // Fallback if defineProperty fails (e.g. already locked)
    (window as any).open = myOpen;
  }

  // Intercept click hijacking via dynamic link clicks (capturing phase)
  window.addEventListener("click", (e: MouseEvent) => {
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
      // Block standard ad URLs on all sites
      if (isAdUrl(href)) {
        console.warn("[AdBlocker] Hook blocked click redirection to:", href);
        e.preventDefault();
        e.stopPropagation();
        return false;
      }

      // Block programmatic (untrusted) clicks going to external origins
      // On streaming sites, check strict non-origin block. On normal sites, check keyword list block.
      const shouldBlockUntrusted = isStreaming 
        ? isExternalAdUrl(href)
        : isAdUrl(href);

      if (!e.isTrusted && shouldBlockUntrusted) {
        console.warn("[AdBlocker] Hook blocked untrusted programmatic click redirection to:", href);
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }
  }, true);
})();
