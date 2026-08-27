from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected exactly one match in {path}, found {count}: {old!r}')
    file_path.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'src/background.ts',
    'import { getDnrProtectionPolicy } from "./protection-state.mjs";\n',
    'import { getDnrProtectionPolicy, isAutomaticProtectionEnabled } from "./protection-state.mjs";\n',
)

replace_once(
    'src/background.ts',
    '''chrome.storage.onChanged.addListener((changes, area) => {\n  if (area === "sync" && (changes.autoHideAds || changes.disabledSites)) setupDnrRules();\n});\n\n// --- Per-image CLIP result cache (#3) ---\n''',
    '''chrome.storage.onChanged.addListener((changes, area) => {\n  if (area === "sync" && (changes.autoHideAds || changes.disabledSites)) setupDnrRules();\n});\n\nasync function isProtectionEnabledForUrl(url: string) {\n  const settings = await chrome.storage.sync.get(["autoHideAds", "disabledSites"]);\n  return isAutomaticProtectionEnabled(settings, url);\n}\n\n// --- Per-image CLIP result cache (#3) ---\n''',
)

replace_once(
    'src/background.ts',
    '''  if (message.type === "detectAd") {\n    (async () => {\n      try {\n        // The service worker may receive the first page scan before the\n''',
    '''  if (message.type === "detectAd") {\n    (async () => {\n      try {\n        if (!(await isProtectionEnabledForUrl(sender.tab?.url || ""))) {\n          sendResponse({\n            success: true,\n            isAd: false,\n            confidence: 0,\n            method: "Protection bypass",\n            reasons: ["Automatic protection is disabled for this site"],\n          });\n          return;\n        }\n\n        // The service worker may receive the first page scan before the\n''',
)

replace_once(
    'src/background.ts',
    '''    chrome.tabs.get(details.sourceTabId, (sourceTab) => {\n      if (chrome.runtime.lastError || !sourceTab || !sourceTab.url) return;\n      \n      const sourceUrl = sourceTab.url;\n      if (sourceUrl.startsWith("chrome://") || sourceUrl.startsWith("chrome-extension://")) return;\n\n      // Only close popups opened from streaming/ad-prone sites.\n''',
    '''    chrome.tabs.get(details.sourceTabId, async (sourceTab) => {\n      if (chrome.runtime.lastError || !sourceTab || !sourceTab.url) return;\n      \n      const sourceUrl = sourceTab.url;\n      if (sourceUrl.startsWith("chrome://") || sourceUrl.startsWith("chrome-extension://")) return;\n      if (!(await isProtectionEnabledForUrl(sourceUrl))) return;\n\n      // Only close popups opened from streaming/ad-prone sites.\n''',
)

replace_once(
    'src/background.ts',
    '''  chrome.tabs.get(details.tabId, (tab) => {\n    if (chrome.runtime.lastError || !tab || !tab.url) return;\n    \n    const sourceUrl = lastCommittedUrls.get(details.tabId) || tab.url;\n    if (sourceUrl.startsWith("chrome://") || sourceUrl.startsWith("chrome-extension://") || sourceUrl === "about:blank") {\n      return;\n    }\n\n    // Only block same-tab redirects if the source is a streaming site AND the target matches ad patterns\n''',
    '''  chrome.tabs.get(details.tabId, async (tab) => {\n    if (chrome.runtime.lastError || !tab || !tab.url) return;\n    \n    const sourceUrl = lastCommittedUrls.get(details.tabId) || tab.url;\n    if (sourceUrl.startsWith("chrome://") || sourceUrl.startsWith("chrome-extension://") || sourceUrl === "about:blank") {\n      return;\n    }\n    if (!(await isProtectionEnabledForUrl(sourceUrl))) return;\n\n    // Only block same-tab redirects if the source is a streaming site AND the target matches ad patterns\n''',
)

replace_once(
    'src/background.ts',
    '''    chrome.tabs.get(tabId, async (tab) => {\n      if (chrome.runtime.lastError || !tab || !tab.active || tab.status === "loading") return;\n\n      const modelSettings = await chrome.storage.sync.get("visionModel");\n''',
    '''    chrome.tabs.get(tabId, async (tab) => {\n      if (chrome.runtime.lastError || !tab || !tab.active || tab.status === "loading") return;\n      if (!(await isProtectionEnabledForUrl(url))) {\n        tabCategories.delete(tabId);\n        return;\n      }\n\n      const modelSettings = await chrome.storage.sync.get("visionModel");\n''',
)

replace_once(
    'src/inject.ts',
    'import { isAdUrl as sharedIsAdUrl, isStreamingKeywordSite, isLocalDevelopmentUrl } from "./shared";\n',
    'import { isAdUrl as sharedIsAdUrl, isStreamingKeywordSite, isLocalDevelopmentUrl } from "./shared";\nimport { isAutomaticProtectionEnabled } from "./protection-state.mjs";\n',
)

replace_once(
    'src/inject.ts',
    '''  let tabCategory = "General Site";\n  let siteBlockingEnabled = true;\n  try {\n    chrome.storage.sync.get(["disabledSites"], (res) => {\n      siteBlockingEnabled = !(res.disabledSites || []).includes(window.location.hostname.toLowerCase());\n    });\n    chrome.storage.onChanged.addListener((changes, area) => {\n      if (area === "sync" && changes.disabledSites) {\n        siteBlockingEnabled = !(changes.disabledSites.newValue || []).includes(window.location.hostname.toLowerCase());\n      }\n    });\n  } catch {}\n''',
    '''  let tabCategory = "General Site";\n  let siteBlockingEnabled = true;\n  let currentProtectionSettings: { autoHideAds?: boolean; disabledSites?: string[] } = {};\n  const applyProtectionSettings = (settings: typeof currentProtectionSettings) => {\n    currentProtectionSettings = settings;\n    siteBlockingEnabled = isAutomaticProtectionEnabled(settings, window.location.href);\n  };\n  try {\n    chrome.storage.sync.get(["autoHideAds", "disabledSites"], (settings) => {\n      applyProtectionSettings(settings);\n    });\n    chrome.storage.onChanged.addListener((changes, area) => {\n      if (area === "sync" && (changes.autoHideAds || changes.disabledSites)) {\n        applyProtectionSettings({\n          autoHideAds: changes.autoHideAds ? changes.autoHideAds.newValue : currentProtectionSettings.autoHideAds,\n          disabledSites: changes.disabledSites ? changes.disabledSites.newValue : currentProtectionSettings.disabledSites,\n        });\n      }\n    });\n  } catch {}\n''',
)

replace_once(
    'src/inject.ts',
    '''  const shouldBlockRedirect = (targetUrl: string): boolean => {\n    if (!fullProtectionEnabled) return false;\n''',
    '''  const shouldBlockRedirect = (targetUrl: string): boolean => {\n    if (!fullProtectionEnabled || !siteBlockingEnabled) return false;\n''',
)

replace_once(
    'src/inject.ts',
    '''  window.addEventListener("click", (e: MouseEvent) => {\n    if (!fullProtectionEnabled) return;\n''',
    '''  window.addEventListener("click", (e: MouseEvent) => {\n    if (!fullProtectionEnabled || !siteBlockingEnabled) return;\n''',
)

replace_once(
    'src/content.js',
    '''  scanIframes() {\n    if (!this.autoHideAds) return;\n''',
    '''  scanIframes() {\n    if (!this.autoHideAds || this.siteDisabled) return;\n''',
)

print('Applied remaining true-bypass implementation')
