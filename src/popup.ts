import { STREAMING_KEYWORDS, COMIC_KEYWORDS } from "./shared";

document.addEventListener("DOMContentLoaded", () => {
  const autoHideToggle = document.getElementById("auto-hide-toggle") as HTMLInputElement;
  const visionModelSelect = document.getElementById("vision-model-select") as HTMLSelectElement;
  const siteBlockToggle = document.getElementById("site-block-toggle") as HTMLInputElement;
  const protectionCard = document.getElementById("protection-card") as HTMLElement;
  const statusIcon = document.getElementById("status-icon") as HTMLElement;
  const statusLabel = document.getElementById("status-label") as HTMLElement;
  const statusDetail = document.getElementById("status-detail") as HTMLElement;
  const currentSite = document.getElementById("current-site") as HTMLElement;
  const adListContainer = document.getElementById("ad-list") as HTMLElement;
  const emptyState = document.getElementById("empty-ads-state") as HTMLElement;
  const adCountBadge = document.getElementById("ad-count-badge") as HTMLElement;
  const adCountSummary = document.getElementById("ad-count-summary") as HTMLElement;
  const aiCategoryText = document.getElementById("ai-category-text") as HTMLElement;
  const historyListContainer = document.getElementById("history-list") as HTMLElement;
  const emptyHistoryState = document.getElementById("empty-history-state") as HTMLElement;
  const historySummary = document.getElementById("history-summary") as HTMLElement;
  const clearHistoryBtn = document.getElementById("clear-history-btn") as HTMLButtonElement;

  chrome.storage.sync.get(["autoHideAds", "visionModel"], (res) => {
    if (res.autoHideAds !== undefined) autoHideToggle.checked = res.autoHideAds;
    visionModelSelect.value = res.visionModel || "clip";
    updateProtectionState();
  });

  autoHideToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ autoHideAds: autoHideToggle.checked }, updateProtectionState);
  });

  visionModelSelect.addEventListener("change", () => {
    chrome.storage.sync.set({ visionModel: visionModelSelect.value });
  });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    const site = getSiteKey(activeTab?.url);

    if (!site) {
      siteBlockToggle.disabled = true;
      currentSite.textContent = "This browser page";
      statusDetail.textContent = "Protection is unavailable on browser-internal pages.";
      updateProtectionState();
      return;
    }

    currentSite.textContent = site;
    chrome.storage.sync.get(["disabledSites"], (res) => {
      siteBlockToggle.checked = !(res.disabledSites || []).includes(site);
      updateProtectionState();
    });

    siteBlockToggle.addEventListener("change", () => {
      chrome.storage.sync.get(["disabledSites"], (current) => {
        const sites = new Set<string>(current.disabledSites || []);
        if (siteBlockToggle.checked) sites.delete(site);
        else sites.add(site);
        chrome.storage.sync.set({ disabledSites: Array.from(sites) }, updateProtectionState);
      });
    });
  });

  function updateProtectionState() {
    const globalEnabled = autoHideToggle.checked;
    const siteEnabled = !siteBlockToggle.disabled && siteBlockToggle.checked;
    const enabled = globalEnabled && siteEnabled;

    protectionCard.classList.toggle("off", !enabled);
    statusIcon.textContent = enabled ? "✓" : "–";
    statusLabel.textContent = enabled ? "Protection is on" : "Protection is off";

    if (siteBlockToggle.disabled) {
      statusDetail.textContent = "Protection is unavailable on browser-internal pages.";
    } else if (!globalEnabled) {
      statusDetail.textContent = "Automatic ad detection is turned off globally.";
    } else if (!siteEnabled) {
      statusDetail.textContent = "Ads are allowed on this site.";
    } else {
      statusDetail.textContent = "Ads are automatically detected and hidden.";
    }
  }

  function getSiteKey(url?: string) {
    try {
      const parsed = new URL(url || "");
      if (!["http:", "https:"].includes(parsed.protocol)) return "";
      return parsed.hostname.toLowerCase();
    } catch {
      return "";
    }
  }

  loadTabAds();
  loadAdHistory();
  queryTabCategory();

  function queryTabCategory() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab?.id) return;

      const urlStr = activeTab.url || "";
      let fallbackCategory = "General";
      try {
        const host = new URL(urlStr).hostname.toLowerCase();
        if (STREAMING_KEYWORDS.some((kw) => host.includes(kw))) fallbackCategory = "Streaming";
        else if (COMIC_KEYWORDS.some((kw) => host.includes(kw))) fallbackCategory = "Comics";
      } catch {}

      aiCategoryText.textContent = fallbackCategory;

      chrome.runtime.sendMessage({ type: "getTabCategory", tabId: activeTab.id }, (res) => {
        if (res?.category && res.confidence > 0) {
          const shortLabels: Record<string, string> = {
            "Movie Streaming": "Streaming",
            "Comic/Manga": "Comics",
            "News/Articles": "News",
            "Developer Page": "Developer",
            "E-Commerce": "Shopping",
            "Search Engine": "Search",
            "General Site": "General",
          };
          aiCategoryText.textContent = shortLabels[res.category] || res.category;
          aiCategoryText.title = `${res.category} · ${res.confidence}% confidence`;
        }
      });
    });
  }

  clearHistoryBtn.addEventListener("click", () => {
    chrome.storage.local.set({ adBlockHistory: [] }, () => renderHistory([]));
  });

  function loadAdHistory() {
    chrome.storage.local.get(["adBlockHistory"], (res) => renderHistory(res.adBlockHistory || []));
  }

  function renderHistory(history: any[]) {
    const totalBlocks = history.reduce((sum, ad) => sum + (Number(ad.count) || 1), 0);
    historySummary.textContent = totalBlocks > 0
      ? `${totalBlocks} block${totalBlocks === 1 ? "" : "s"} recorded`
      : "No recent blocks";
    clearHistoryBtn.disabled = history.length === 0;

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

      let pageDomain = "unknown page";
      try { pageDomain = new URL(ad.pageUrl).hostname; } catch {}

      const info = document.createElement("div");
      info.className = "ad-item-info";

      const domain = document.createElement("span");
      domain.className = "ad-domain";
      domain.textContent = ad.domain || "Unknown source";
      domain.title = ad.url || "";

      const meta = document.createElement("span");
      meta.className = "ad-meta";
      meta.textContent = `${pageDomain} · blocked ${ad.count || 1}×`;

      info.append(domain, meta);

      const time = document.createElement("span");
      time.className = "ad-meta";
      time.textContent = formatRelativeTime(ad.timestamp);

      item.append(info, time);
      historyListContainer.appendChild(item);
    });
  }

  function formatRelativeTime(timestamp: number) {
    const diffMinutes = Math.max(0, Math.round((Date.now() - Number(timestamp || 0)) / 60000));
    if (diffMinutes < 1) return "now";
    if (diffMinutes < 60) return `${diffMinutes}m`;
    const hours = Math.round(diffMinutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.round(hours / 24)}d`;
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
    adCountSummary.textContent = String(ads.length);

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
      domain.textContent = ad.domain || "Unknown ad source";

      const meta = document.createElement("span");
      meta.className = "ad-meta";
      const dimensions = ad.width && ad.height ? ` · ${ad.width}×${ad.height}` : "";
      meta.textContent = `${ad.confidence || 0}% confidence${dimensions}`;
      meta.title = ad.method || "Ad detection";

      info.append(domain, meta);

      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      updateAdButton(toggleBtn, ad.isHidden);

      toggleBtn.addEventListener("click", () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const activeTab = tabs[0];
          if (!activeTab?.id) return;

          chrome.tabs.sendMessage(activeTab.id, {
            type: "toggleAdVisibility",
            adId: ad.id,
            hide: !ad.isHidden,
          }, (res) => {
            if (res?.success) {
              ad.isHidden = res.isHidden;
              updateAdButton(toggleBtn, ad.isHidden);
            }
          });
        });
      });

      item.append(info, toggleBtn);
      adListContainer.appendChild(item);
    });
  }

  function updateAdButton(button: HTMLButtonElement, hidden: boolean) {
    button.className = `btn-toggle-ad ${hidden ? "hidden" : "visible"}`;
    button.textContent = hidden ? "Show" : "Hide";
    button.title = hidden ? "Temporarily show this item" : "Hide this item";
  }
});
