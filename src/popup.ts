document.addEventListener("DOMContentLoaded", () => {
  const autoHideToggle = document.getElementById("auto-hide-toggle") as HTMLInputElement;
  const adListContainer = document.getElementById("ad-list") as HTMLElement;
  const emptyState = document.getElementById("empty-ads-state") as HTMLElement;
  const adCountBadge = document.getElementById("ad-count-badge") as HTMLElement;

  chrome.storage.sync.get(["autoHideAds"], (res) => {
    if (res.autoHideAds !== undefined) {
      autoHideToggle.checked = res.autoHideAds;
    }
  });

  autoHideToggle.addEventListener("change", () => {
    chrome.storage.sync.set({ autoHideAds: autoHideToggle.checked });
  });

  loadTabAds();

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
