from pathlib import Path

path = Path('src/background.ts')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        '''async function isProtectionEnabledForUrl(url: string) {\n  const settings = await chrome.storage.sync.get(["autoHideAds", "disabledSites"]);\n  return isAutomaticProtectionEnabled(settings, url);\n}\n\n// --- Per-image CLIP result cache (#3) ---\n''',
        '''async function isProtectionEnabledForUrl(url: string) {\n  const settings = await chrome.storage.sync.get(["autoHideAds", "disabledSites"]);\n  return isAutomaticProtectionEnabled(settings, url);\n}\n\nasync function isTabStillProtected(tabId: number, expectedUrl: string) {\n  try {\n    const currentTab = await chrome.tabs.get(tabId);\n    if (!currentTab?.url || currentTab.url !== expectedUrl) return false;\n    return isProtectionEnabledForUrl(currentTab.url);\n  } catch {\n    return false;\n  }\n}\n\n// --- Per-image CLIP result cache (#3) ---\n''',
    ),
    (
        '''              if (isAdPage && topMatch.score >= 0.50) {\n                console.warn(`[AdBlocker] AI visually identified popup tab ${tabId} as an AD LANDER: "${topMatch.label}" (${confidence}% confidence). Closing tab.`);\n''',
        '''              if (isAdPage && topMatch.score >= 0.50) {\n                if (!(await isTabStillProtected(tabId, url))) return;\n                console.warn(`[AdBlocker] AI visually identified popup tab ${tabId} as an AD LANDER: "${topMatch.label}" (${confidence}% confidence). Closing tab.`);\n''',
    ),
    (
        '''            console.log(`[AdBlocker] AI Classified tab ${tabId} (${url}) as: ${category} (${finalConfidence}% confidence)`);\n            tabCategories.set(tabId, { category, confidence: finalConfidence });\n''',
        '''            if (!(await isTabStillProtected(tabId, url))) {\n              tabCategories.delete(tabId);\n              return;\n            }\n            console.log(`[AdBlocker] AI Classified tab ${tabId} (${url}) as: ${category} (${finalConfidence}% confidence)`);\n            tabCategories.set(tabId, { category, confidence: finalConfidence });\n''',
    ),
]

for old, new in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'Expected one match, found {count}: {old!r}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('Applied page-classification bypass revalidation')
