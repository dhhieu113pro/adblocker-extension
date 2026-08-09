(function() {
  const adKeywords = [
    "rg.pro.vn", "bboocclink", "154.82.109.", "adcenter", "vsbet", 
    "colatv", "8svui", "i9.top", "betting", "casino", "nhacai",
    "affiliate", "promos", "redirect", "sponsored", "adserver",
    "advert", "popup", "clickunder", "popunder"
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
      return false; // Fallback on parse errors (safely allow)
    }
  };

  // Hook window.open
  const originalOpen = window.open;
  (window as any).open = function(url?: string | URL, target?: string, features?: string) {
    if (url) {
      if (isAdUrl(url) || isExternalAdUrl(url)) {
        console.warn("[AdBlocker] Hook blocked window.open popup redirect to:", url);
        return null;
      }
    }
    return originalOpen.apply(this, arguments as any);
  };

  // Intercept click hijacking via dynamic link clicks (capturing phase)
  window.addEventListener("click", (e: MouseEvent) => {
    const link = (e.target as HTMLElement)?.closest?.("a");
    if (link) {
      const href = link.href || "";
      if (isAdUrl(href)) {
        console.warn("[AdBlocker] Hook blocked click redirection to:", href);
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    }
  }, true);
})();
