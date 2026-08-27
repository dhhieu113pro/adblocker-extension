import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Missing patch anchor: ${label}`);
  const updated = source.replace(before, after);
  if (updated === source) throw new Error(`Patch made no change: ${label}`);
  return updated;
}

function patchBackground() {
  const path = "src/background.ts";
  let source = readFileSync(path, "utf8");

  source = replaceOnce(
    source,
    'import { isAdUrl, isExternalAdUrl, isStreamingKeywordSite, isLocalDevelopmentUrl, AD_DOMAINS, loadRemoteAdRules } from "./shared";\n',
    'import { isAdUrl, isExternalAdUrl, isStreamingKeywordSite, isLocalDevelopmentUrl, AD_DOMAINS, loadRemoteAdRules } from "./shared";\nimport { FULL_SITE_ORIGINS, syncFullProtectionRegistration } from "./site-access";\n',
    "background site-access import",
  );

  const oldInstalled = `chrome.runtime.onInstalled.addListener(() => {
  console.log("AI Vision Ad Blocker extension installed");
  chrome.contextMenus.create({
    id: "analyze-image-ad",
    title: "✨ Analyze with AI & Detect Ad",
    contexts: ["image"],
  });
});`;

  const newInstalled = `async function syncAnalyzeContextMenu(enabled: boolean) {
  await chrome.contextMenus.removeAll();
  if (!enabled) return;
  chrome.contextMenus.create({
    id: "analyze-image-ad",
    title: "✨ Analyze with AI & Detect Ad",
    contexts: ["image"],
  });
}

async function syncSiteAccessState() {
  const enabled = await syncFullProtectionRegistration();
  await chrome.storage.local.set({ fullSiteAccessEnabled: enabled });
  await syncAnalyzeContextMenu(enabled);
  return enabled;
}

async function broadcastFullProtectionState(enabled: boolean) {
  const type = enabled ? "fullProtectionEnabled" : "fullProtectionDisabled";
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async (tab) => {
    if (!tab.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type });
    } catch {
      // Tabs without the packaged content script are expected in baseline mode.
    }
  }));
}

syncSiteAccessState()
  .then((enabled) => enabled ? undefined : broadcastFullProtectionState(false))
  .catch((error) => console.warn("[AdBlocker] Site access startup sync failed:", error));

chrome.runtime.onInstalled.addListener(() => {
  console.log("AI Vision Ad Blocker extension installed");
  syncSiteAccessState().catch((error) => console.warn("[AdBlocker] Site access install sync failed:", error));
});

chrome.permissions.onAdded.addListener(async (permissions) => {
  if (!permissions.origins?.some((origin) => FULL_SITE_ORIGINS.includes(origin))) return;
  await syncSiteAccessState();
});

chrome.permissions.onRemoved.addListener(async (permissions) => {
  if (!permissions.origins?.some((origin) => FULL_SITE_ORIGINS.includes(origin))) return;
  const enabled = await syncSiteAccessState();
  if (!enabled) await broadcastFullProtectionState(false);
});`;

  source = replaceOnce(source, oldInstalled, newInstalled, "background install/permission lifecycle");

  const listenerAnchor = `chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getTabCategory") {`;
  const listenerReplacement = `chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "activateFullProtectionOnTab") {
    (async () => {
      const enabled = await syncSiteAccessState();
      if (!enabled || !message.tabId) {
        sendResponse({ success: false, enabled });
        return;
      }

      const tab = await chrome.tabs.get(message.tabId);
      if (!/^https?:/i.test(tab.url || "")) {
        sendResponse({ success: false, enabled, unsupported: true });
        return;
      }

      await chrome.scripting.executeScript({
        target: { tabId: message.tabId, allFrames: true },
        files: ["runtime/inject.js"],
        world: "MAIN",
      });
      await chrome.scripting.executeScript({
        target: { tabId: message.tabId, allFrames: true },
        files: ["runtime/content.js"],
        world: "ISOLATED",
      });
      try {
        await chrome.tabs.sendMessage(message.tabId, { type: "fullProtectionEnabled" });
      } catch {
        // The just-injected content script may still be finishing initialization.
      }
      sendResponse({ success: true, enabled: true });
    })().catch((error) => sendResponse({ success: false, error: String(error) }));
    return true;
  }

  if (message.type === "getTabCategory") {`;

  source = replaceOnce(source, listenerAnchor, listenerReplacement, "background activation message");
  writeFileSync(path, source);
}

function patchContent() {
  const path = "src/content.js";
  let source = readFileSync(path, "utf8");

  const listenerAnchor = `  initMessageListener() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "getTabDetectedAds") {`;
  const listenerReplacement = `  initMessageListener() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "fullProtectionDisabled") {
        this.siteDisabled = true;
        this.disableSiteBlocking();
        window.dispatchEvent(new CustomEvent("aiVisionFullProtectionState", { detail: false }));
        sendResponse({ success: true });
        return true;
      }
      if (message.type === "fullProtectionEnabled") {
        chrome.storage.sync.get(["disabledSites"], (res) => {
          const site = window.location.hostname.toLowerCase();
          this.siteDisabled = Array.isArray(res.disabledSites) && res.disabledSites.includes(site);
          window.dispatchEvent(new CustomEvent("aiVisionFullProtectionState", { detail: true }));
          if (!this.siteDisabled) {
            this.processedImages = new WeakSet();
            this.scheduleScan();
          }
          sendResponse({ success: true, enabled: !this.siteDisabled });
        });
        return true;
      }
      if (message.type === "getTabDetectedAds") {`;
  source = replaceOnce(source, listenerAnchor, listenerReplacement, "content protection-state messages");

  source = replaceOnce(
    source,
    "\nnew AdBlockerOverlay();",
    `
if (!globalThis.__aiVisionAdBlockerContentInitialized) {
  globalThis.__aiVisionAdBlockerContentInitialized = true;
  new AdBlockerOverlay();
}`,
    "content initialization sentinel",
  );

  writeFileSync(path, source);
}

function patchInject() {
  const path = "src/inject.ts";
  let source = readFileSync(path, "utf8");

  source = replaceOnce(
    source,
    `(function() {
  // Wrappers bind page context (relative URL resolution / current page host)`,
    `(function() {
  if ((window as any).__aiVisionAdBlockerMainInitialized) return;
  (window as any).__aiVisionAdBlockerMainInitialized = true;
  let fullProtectionEnabled = true;

  // Wrappers bind page context (relative URL resolution / current page host)`,
    "main-world initialization sentinel",
  );

  source = replaceOnce(
    source,
    `  const shouldBlockRedirect = (targetUrl: string): boolean => {
    const isStreaming = isStreamingOrAdProneSite(window.location.href);`,
    `  const shouldBlockRedirect = (targetUrl: string): boolean => {
    if (!fullProtectionEnabled) return false;
    const isStreaming = isStreamingOrAdProneSite(window.location.href);`,
    "main-world redirect guard",
  );

  source = replaceOnce(
    source,
    `  const originalOpen = window.open;
  const myOpen = function(url?: string | URL, target?: string, features?: string) {`,
    `  const originalOpen = window.open;
  const handleFullProtectionState = (event: any) => {
    fullProtectionEnabled = event.detail !== false;
    if (fullProtectionEnabled) return;

    try {
      Object.defineProperty(window, "open", {
        value: originalOpen,
        writable: true,
        configurable: true,
      });
    } catch {}
    (window as any).__aiVisionAdBlockerMainInitialized = false;
    window.removeEventListener("aiVisionFullProtectionState", handleFullProtectionState);
  };
  window.addEventListener("aiVisionFullProtectionState", handleFullProtectionState);

  const myOpen = function(url?: string | URL, target?: string, features?: string) {`,
    "main-world revocation event",
  );

  source = replaceOnce(
    source,
    `  window.addEventListener("click", (e: MouseEvent) => {
    if (isLocalDevelopmentUrl(window.location.href)) return;`,
    `  window.addEventListener("click", (e: MouseEvent) => {
    if (!fullProtectionEnabled) return;
    if (isLocalDevelopmentUrl(window.location.href)) return;`,
    "main-world click guard",
  );

  writeFileSync(path, source);
}

patchBackground();
patchContent();
patchInject();
console.log("Task 3 optional-access patches applied");
