export const FULL_SITE_ORIGINS = ["http://*/*", "https://*/*"];
export const CONTENT_SCRIPT_ID = "ai-vision-content";
export const MAIN_WORLD_SCRIPT_ID = "ai-vision-main";

const SCRIPT_IDS = [CONTENT_SCRIPT_ID, MAIN_WORLD_SCRIPT_ID];

export async function hasFullSiteAccess() {
  return chrome.permissions.contains({ origins: [...FULL_SITE_ORIGINS] });
}

export async function requestFullSiteAccess() {
  return chrome.permissions.request({ origins: [...FULL_SITE_ORIGINS] });
}

export async function unregisterFullProtectionScripts() {
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: SCRIPT_IDS });
  const registeredIds = registered.map((script) => script.id);
  if (registeredIds.length === 0) return;
  await chrome.scripting.unregisterContentScripts({ ids: registeredIds });
}

export async function registerFullProtectionScripts() {
  await unregisterFullProtectionScripts();
  await chrome.scripting.registerContentScripts([
    {
      id: MAIN_WORLD_SCRIPT_ID,
      js: ["runtime/inject.js"],
      matches: [...FULL_SITE_ORIGINS],
      runAt: "document_start",
      allFrames: true,
      world: "MAIN",
      persistAcrossSessions: true,
    },
    {
      id: CONTENT_SCRIPT_ID,
      js: ["runtime/report-bridge.js", "runtime/content.js"],
      matches: [...FULL_SITE_ORIGINS],
      runAt: "document_idle",
      allFrames: true,
      world: "ISOLATED",
      persistAcrossSessions: true,
    },
  ]);
}

export async function syncFullProtectionRegistration() {
  const enabled = await hasFullSiteAccess();
  if (enabled) await registerFullProtectionScripts();
  else await unregisterFullProtectionScripts();
  return enabled;
}
