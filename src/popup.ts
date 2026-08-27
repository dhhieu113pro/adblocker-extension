import { STREAMING_KEYWORDS, COMIC_KEYWORDS } from "./shared";
import { hasFullSiteAccess, requestFullSiteAccess } from "./site-access";

document.addEventListener("DOMContentLoaded", () => {
  const autoHideToggle = document.getElementById("auto-hide-toggle") as HTMLInputElement;
  const visionModelSelect = document.getElementById("vision-model-select") as HTMLSelectElement;
  const siteBlockToggle = document.getElementById("site-block-toggle") as HTMLInputElement;
  const enableFullProtectionBtn = document.getElementById("enable-full-protection-btn") as HTMLButtonElement;
  const protectionCard = document.getElementById("protection-card") as HTMLElement;
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
  const versionLabel = document.getElementById("version-label") as HTMLElement;
  const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='tab']"));
  const tabPanels = Array.from(document.querySelectorAll<HTMLElement>("[role='tabpanel']"));

  let fullSiteAccess = false;
  let currentSiteKey = "";
  let currentSiteSupported = false;

  versionLabel.textContent = `v${chrome.runtime.getManifest().version}`;

  function activateTab(tabId: string, focus = false) {
    const activeButtonId = `tab-${tabId}`;
    const activePanelId = `panel-${tabId}`;

    tabButtons.forEach((button) => {
      const active = button.id === activeButtonId;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus();
    });

    tabPanels.forEach((panel) => {
      panel.hidden = panel.id !== activePanelId;
    });
  }

  tabButtons.forEach((button, index) => {
    button.addEventListener("click", () => {
      activateTab(button.id.replace("tab-", ""));
    });

    button.addEventListener("keydown", (event) => {
      let nextIndex = index;

      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabButtons.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabButtons.length) % tabButtons.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = tabButtons.length - 1;
      else return;

      event.preventDefault();
      activateTab(tabButtons[nextIndex].id.replace("tab-", ""), true);
    });
  });

  // A newly opened popup always starts on the browsing-focused Overview tab.
  activateTab("overview");

  chrome.storage.sync.get(["autoHideAds", "visionModel"], (res) => {
    if (res.autoHideAds !== undefined) autoHideToggle.checked = res.autoHideAds;
    visionModelSelect.value = res.visionModel || "mobilenet";
    refreshSiteAccessState().catch(() => {
      fullSiteAccess = false;
      updateProtectionState();
      renderAccessRequiredState();
    });
  });

  autoHideToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ autoHideAds: autoHideToggle.checked }, updateProtectionState);
  });

  visionModelSelect.addEventListener("change", () => {
    chrome.storage.sync.set({ visionModel: visionModelSelect.value });
  });

  siteBlockToggle.addEventListener("change", () => {
    if (!fullSiteAccess || !currentSiteKey) return;

    chrome.storage.sync.get(["disabledSites"], (current) => {
      const sites = new Set<string>(current.disabledSites || []);
      if (siteBlockToggle.checked) sites.delete(currentSiteKey);
      else sites.add(currentSiteKey);
      chrome.storage.sync.set({ disabledSites: Array.from(sites) }, updateProtectionState);
    });
  });

  enableFullProtectionBtn.addEventListener("click", async () => {
    enableFullProtectionBtn.disabled = true;
    try {
      const granted = await requestFullSiteAccess();
      if (granted) {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab?.id) {
          await chrome.runtime.sendMessage({
            type: "activateFullProtectionOnTab",
            tabId: activeTab.id,
          });
        }
      }
      await refreshSiteAccessState();
    } finally {
      enableFullProtectionBtn.disabled = false;
    }
  });

  chrome.permissions.onRemoved.addListener(() => {
    refreshSiteAccessState().catch(() => undefined);
  });

  function updateProtectionState() {
    if (!fullSiteAccess) {
      protectionCard.classList.remove("off", "unavailable");
      statusLabel.textContent = "Basic protection is on";
      statusDetail.textContent = "Known ad networks are blocked. Enable full protection for AI and page-level detection.";
      enableFullProtectionBtn.hidden = false;
      siteBlockToggle.disabled = true;
      return;
    }

    enableFullProtectionBtn.hidden = true;
    const unavailable = !currentSiteSupported || siteBlockToggle.disabled;
    const globalEnabled = autoHideToggle.checked;
    const siteEnabled = !unavailable && siteBlockToggle.checked;
    const enabled = globalEnabled && siteEnabled;

    protectionCard.classList.toggle("unavailable", unavailable);
    protectionCard.classList.toggle("off", !unavailable && !enabled);

    if (unavailable) {
      statusLabel.textContent = "Protection unavailable";
      statusDetail.textContent = "Protection is unavailable on browser-internal pages.";
    } else if (!globalEnabled) {
      statusLabel.textContent = "Protection is off";
      statusDetail.textContent = "Automatic ad detection is turned off globally.";
    } else if (!siteEnabled) {
      statusLabel.textContent = "Protection is off";
      statusDetail.textContent = "Ads are allowed on this site.";
    } else {
      statusLabel.textContent = "Protection is on";
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

  async function refreshSiteAccessState() {
    fullSiteAccess = await hasFullSiteAccess();
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentSiteKey = getSiteKey(activeTab?.url);
    currentSiteSupported = Boolean(currentSiteKey);

    if (!fullSiteAccess) {
      currentSite.textContent = currentSiteKey || "Website access not granted";
      siteBlockToggle.checked = false;
      siteBlockToggle.disabled = true;
      aiCategoryText.textContent = "Basic";
      aiCategoryText.title = "Network-level protection";
      updateProtectionState();
      renderAccessRequiredState();
      return;
    }

    currentSite.textContent = currentSiteKey || "This browser page";
    if (!currentSiteSupported) {
      siteBlockToggle.checked = false;
      siteBlockToggle.disabled = true;
      aiCategoryText.textContent = "General";
      aiCategoryText.title = "";
      updateProtectionState();
      renderAds([]);
      return;
    }

    const settings = await chrome.storage.sync.get(["disabledSites"]);
    siteBlockToggle.checked = !(settings.disabledSites || []).includes(currentSiteKey);
    siteBlockToggle.disabled = false;
    updateProtectionState();
    loadTabAds();
    queryTabCategory();
  }

  loadAdHistory();

  function queryTabCategory() {
    if (!fullSiteAccess) return;

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
      item.className = "history-item";

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
      time.className = "row-time";
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
    if (!fullSiteAccess) {
      renderAccessRequiredState();
      return;
    }

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

  function setEmptyAdsState(title: string, detail: string) {
    emptyState.style.display = "flex";
    emptyState.innerHTML = "";
    const heading = document.createElement("strong");
    heading.textContent = title;
    const copy = document.createElement("span");
    copy.textContent = detail;
    emptyState.append(heading, copy);
    adListContainer.innerHTML = "";
    adListContainer.appendChild(emptyState);
  }

  function renderAccessRequiredState() {
    adCountBadge.textContent = "0";
    adCountSummary.textContent = "0";
    setEmptyAdsState(
      "Full protection is optional",
      "Enable full protection to detect and hide page-level ads.",
    );
  }

  function renderAds(ads: any[]) {
    adCountBadge.textContent = String(ads.length);
    adCountSummary.textContent = String(ads.length);

    if (ads.length === 0) {
      setEmptyAdsState("Nothing suspicious found", "This page looks clean so far.");
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
