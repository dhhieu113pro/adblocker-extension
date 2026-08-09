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

  // Hook window.open
  const originalOpen = window.open;
  (window as any).open = function(url?: string | URL, target?: string, features?: string) {
    if (url && isAdUrl(url)) {
      console.warn("[AdBlocker] Hook blocked window.open popup redirect to:", url);
      return null;
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
