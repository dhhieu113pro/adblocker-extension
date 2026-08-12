import { STREAMING_KEYWORDS, COMIC_KEYWORDS } from "./shared";

document.addEventListener("DOMContentLoaded", () => {
  const autoHideToggle = document.getElementById("auto-hide-toggle") as HTMLInputElement;
  const adListContainer = document.getElementById("ad-list") as HTMLElement;
  const emptyState = document.getElementById("empty-ads-state") as HTMLElement;
  const adCountBadge = document.getElementById("ad-count-badge") as HTMLElement;

  const historyListContainer = document.getElementById("history-list") as HTMLElement;
  const emptyHistoryState = document.getElementById("empty-history-state") as HTMLElement;
  const clearHistoryBtn = document.getElementById("clear-history-btn") as HTMLElement;

  const aiCategoryBadge = document.getElementById("ai-category-badge") as HTMLElement;
  const aiCategoryText = document.getElementById("ai-category-text") as HTMLElement;

  chrome.storage.sync.get(["autoHideAds"], (res) => {
    if (res.autoHideAds !== undefined) {
      autoHideToggle.checked = res.autoHideAds;
    }
  });

  autoHideToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ autoHideAds: autoHideToggle.checked });
  });

  loadTabAds();
  loadAdHistory();
  queryTabCategory();

  function queryTabCategory() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab?.id) return;
      
      // 1. Initial Heuristic Guess based on active URL
      const urlStr = activeTab.url || "";
      let initialCategory = "General Site";
      let matchedHeuristics = false;
      try {
        const host = new URL(urlStr).hostname.toLowerCase();
        const movieKeywords = STREAMING_KEYWORDS;
        const comicKeywords = COMIC_KEYWORDS;
        
        if (movieKeywords.some(kw => host.includes(kw))) {
          initialCategory = "🎬 Movie Streaming (Heuristic)";
          matchedHeuristics = true;
        } else if (comicKeywords.some(kw => host.includes(kw))) {
          initialCategory = "📖 Comic/Manga (Heuristic)";
          matchedHeuristics = true;
        }
      } catch {}

      if (matchedHeuristics) {
        aiCategoryText.textContent = initialCategory;
        aiCategoryBadge.style.display = "flex";
      } else {
        // Show loading/analyzing state for general sites
        aiCategoryText.textContent = "🔍 Analyzing page layout...";
        aiCategoryBadge.style.display = "flex";
      }

      // 2. Query Background service worker for CLIP AI zero-shot classification
      chrome.runtime.sendMessage({ type: "getTabCategory", tabId: activeTab.id }, (res) => {
        if (res && res.category && res.confidence > 0) {
          let categoryEmoji = "🌐";
          if (res.category === "Movie Streaming") categoryEmoji = "🎬";
          else if (res.category === "Comic/Manga") categoryEmoji = "📖";
          else if (res.category === "News/Articles") categoryEmoji = "📰";
          else if (res.category === "Developer Page") categoryEmoji = "💻";
          else if (res.category === "E-Commerce") categoryEmoji = "🛒";
          else if (res.category === "Search Engine") categoryEmoji = "🔍";

          aiCategoryText.textContent = `${categoryEmoji} ${res.category} (${res.confidence}% AI)`;
          aiCategoryBadge.style.display = "flex";
        } else if (!matchedHeuristics) {
          // If no heuristics and no AI result yet, show General Site
          aiCategoryText.textContent = "🌐 General Site";
          aiCategoryBadge.style.display = "flex";
        }
      });
    });
  }

  clearHistoryBtn.addEventListener("click", () => {
    chrome.storage.local.set({ adBlockHistory: [] }, () => {
      renderHistory([]);
    });
  });

  function loadAdHistory() {
    chrome.storage.local.get(["adBlockHistory"], (res) => {
      renderHistory(res.adBlockHistory || []);
    });
  }

  function renderHistory(history: any[]) {
    if (history.length === 0) {
      emptyHistoryState.style.display = "flex";
      historyListContainer.innerHTML = "";
      historyListContainer.appendChild(emptyHistoryState);
      return;
    }

    emptyHistoryState.style.display = "none";
    historyListContainer.innerHTML = "";

    history.forEach((ad) => {
      const item = document.createElement("div");
      item.className = "ad-item";
      item.style.flexDirection = "column";
      item.style.alignItems = "stretch";
      item.style.gap = "4px";

      let pageDomain = "unknown";
      try {
        pageDomain = new URL(ad.pageUrl).hostname;
      } catch {}

      item.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <span class="ad-domain" style="font-size: 12px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${ad.url}">
            ${ad.domain}
          </span>
          <span style="font-size: 11px; font-weight: bold; background: var(--bg-tertiary); color: var(--accent-color); padding: 2px 8px; border-radius: 10px; white-space: nowrap;">
            Blocked: ${ad.count}
          </span>
        </div>
        <div style="font-size: 11px; color: var(--text-secondary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; width: 100%;">
          <strong>Page:</strong> ${pageDomain}
        </div>
        <div style="font-size: 10px; color: #64748b; text-align: right; width: 100%; margin-top: 2px;">
          Last: ${new Date(ad.timestamp).toLocaleTimeString()}
        </div>
      `;
      historyListContainer.appendChild(item);
    });
  }

  function loadTabAds() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab?.id) return;

      chrome.tabs.sendMessage(activeTab.id, { type: "getTabDetectedAds" }, (res) => {
        if (chrome.runtime.lastError || !res?.success) {
          renderAds([]);
          return;
        }
        renderAds(res.ads || []);
      });
    });
  }

  function renderAds(ads: any[]) {
    adCountBadge.textContent = String(ads.length);

    if (ads.length === 0) {
      emptyState.style.display = "flex";
      adListContainer.innerHTML = "";
      adListContainer.appendChild(emptyState);
      return;
    }

    emptyState.style.display = "none";
    adListContainer.innerHTML = "";

    ads.forEach((ad) => {
      const item = document.createElement("div");
      item.className = "ad-item";

      const info = document.createElement("div");
      info.className = "ad-item-info";

      const domain = document.createElement("span");
      domain.className = "ad-domain";
      domain.textContent = `${ad.domain} (${ad.width}x${ad.height})`;

      const meta = document.createElement("span");
      meta.className = "ad-meta";
      meta.textContent = `${ad.method} • ${ad.confidence}% confidence`;

      info.appendChild(domain);
      info.appendChild(meta);

      const toggleBtn = document.createElement("button");
      toggleBtn.className = `btn-toggle-ad ${ad.isHidden ? "hidden" : "visible"}`;
      toggleBtn.textContent = ad.isHidden ? "Unhide" : "Hide";

      toggleBtn.addEventListener("click", () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const activeTab = tabs[0];
          if (!activeTab?.id) return;

          chrome.tabs.sendMessage(
            activeTab.id,
            {
              type: "toggleAdVisibility",
              adId: ad.id,
              hide: !ad.isHidden,
            },
            (res) => {
              if (res?.success) {
                ad.isHidden = res.isHidden;
                toggleBtn.className = `btn-toggle-ad ${ad.isHidden ? "hidden" : "visible"}`;
                toggleBtn.textContent = ad.isHidden ? "Unhide" : "Hide";
              }
            }
          );
        });
      });

      item.appendChild(info);
      item.appendChild(toggleBtn);
      adListContainer.appendChild(item);
    });
  }
});
