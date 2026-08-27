from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected exactly one match in {path}, found {count}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "src/background.ts",
    'import { FULL_SITE_ORIGINS, syncFullProtectionRegistration } from "./site-access";\n',
    'import { FULL_SITE_ORIGINS, syncFullProtectionRegistration } from "./site-access";\n'
    'import { getDnrProtectionPolicy } from "./protection-state.mjs";\n',
)

replace_once(
    "src/background.ts",
    '''async function setupDnrRules() {
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const existingIds = existing.map((r) => r.id);
    const adDomains = Array.from(AD_DOMAINS);
    const rules = adDomains.map((domain, i) => ({
      id: AD_DNR_BASE + i,
      priority: 1,
      action: { type: "block" as const },
      condition: {
        urlFilter: `||${domain}^`,
        resourceTypes: DNR_RESOURCE_TYPES,
      },
    }));

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingIds,
      addRules: rules,
    });
    console.log(`DNR: ${rules.length} ad-domain block rules installed`);
  } catch (e) {
    console.warn("DNR setup failed:", e);
  }
}

setupDnrRules();
loadRemoteAdRules().then(() => setupDnrRules());
''',
    '''async function setupDnrRules() {
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const existingIds = existing.map((r) => r.id);
    const protectionSettings = await chrome.storage.sync.get(["autoHideAds", "disabledSites"]);
    const { enabled } = getDnrProtectionPolicy(protectionSettings);
    const adDomains = Array.from(AD_DOMAINS);
    const rules = enabled ? adDomains.map((domain, i) => ({
      id: AD_DNR_BASE + i,
      priority: 1,
      action: { type: "block" as const },
      condition: {
        urlFilter: `||${domain}^`,
        resourceTypes: DNR_RESOURCE_TYPES,
      },
    })) : [];

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingIds,
      addRules: rules,
    });
    console.log(`DNR: ${rules.length} ad-domain block rules installed`);
  } catch (e) {
    console.warn("DNR setup failed:", e);
  }
}

setupDnrRules();
loadRemoteAdRules().then(() => setupDnrRules());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.autoHideAds) setupDnrRules();
});
''',
)

replace_once(
    "src/content.js",
    '''      if (area === "sync" && changes.autoHideAds) {
        this.autoHideAds = changes.autoHideAds.newValue;
        if (this.autoHideAds) this.scheduleScan();
      }
''',
    '''      if (area === "sync" && changes.autoHideAds) {
        this.autoHideAds = changes.autoHideAds.newValue;
        if (this.autoHideAds) {
          this.processedImages = new WeakSet();
          this.scheduleScan();
        } else {
          this.disableSiteBlocking();
        }
      }
''',
)

replace_once(
    "src/content.js",
    '''  disableSiteBlocking() {
    this.detectedAdsMap.forEach((ad) => this.unhideElement(ad.targetElement));
    this.detectedAdsMap.clear();
    this.adCheckQueue = [];
    this.adCheckUrls.clear();
  }
''',
    '''  disableSiteBlocking() {
    document.querySelectorAll('[data-webllm-ad-hidden="true"]').forEach((element) => this.unhideElement(element));
    this.detectedAdsMap.clear();
    this.adCheckQueue = [];
    this.adCheckUrls.clear();
    this.processedImages = new WeakSet();
  }
''',
)

print("Applied global true-bypass implementation")
