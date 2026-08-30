import "./background";
import { createPageDetectionState } from "./page-detection-state.mjs";
import {
  clearReportData,
  exportReportData,
  readReportData,
  recordReportEvent,
} from "./reporting-storage";

const TAB_PAGE_DETECTIONS_SESSION_KEY = "tabPageDetectionsV1";
const tabPageDetections = new Map<number, any>();
const tabPageUrls = new Map<number, string>();
let tabDetectionWriteChain = Promise.resolve();

function normalizeDetectionMethod(method: unknown) {
  const value = String(method || "").toLowerCase();
  if (value === "ai" || value.includes("clip") || value.includes("classifier") || value.includes("vision")) return "ai";
  if (value === "network" || value.includes("network") || value.includes("dnr")) return "network";
  return "heuristic";
}

function inferResourceType(message: any) {
  const allowed = new Set(["image", "video", "banner", "overlay", "popup", "script", "pixel", "iframe", "other"]);
  if (allowed.has(message.resourceType)) return message.resourceType;
  if (message.blockType === "popup") return "popup";
  if (message.adDomain === "ad video") return "video";
  return "other";
}

function reportMessage(message: any) {
  return recordReportEvent({
    pageUrl: message.pageUrl,
    sourceUrl: message.sourceUrl || message.adUrl || message.blockedTargetUrl,
    blockedTargetUrl: message.blockedTargetUrl,
    pageMetadata: message.pageMetadata,
    blockType: message.blockType || "ad",
    detectionMethod: normalizeDetectionMethod(message.detectionMethod || message.method),
    resourceType: inferResourceType(message),
  });
}

function enqueueTabDetectionWrite(operation: () => Promise<any>) {
  const next = tabDetectionWriteChain.then(operation, operation);
  tabDetectionWriteChain = next.catch(() => undefined);
  return next;
}

async function persistTabPageDetectionState(tabId: number, state: any) {
  const current = await chrome.storage.session.get(TAB_PAGE_DETECTIONS_SESSION_KEY);
  const stored = { ...(current[TAB_PAGE_DETECTIONS_SESSION_KEY] || {}) };
  stored[String(tabId)] = {
    pageUrl: tabPageUrls.get(tabId) || "",
    ads: state.list(),
  };
  await chrome.storage.session.set({ [TAB_PAGE_DETECTIONS_SESSION_KEY]: stored });
}

async function restoreTabPageDetectionState(tabId: number, pageUrl = "") {
  let state = tabPageDetections.get(tabId);
  if (state) {
    if (pageUrl && state.navigate(pageUrl)) tabPageUrls.set(tabId, pageUrl);
    return state;
  }

  const current = await chrome.storage.session.get(TAB_PAGE_DETECTIONS_SESSION_KEY);
  const saved = current[TAB_PAGE_DETECTIONS_SESSION_KEY]?.[String(tabId)];
  const savedPageUrl = String(saved?.pageUrl || "");
  state = createPageDetectionState(savedPageUrl || pageUrl);
  for (const ad of Array.isArray(saved?.ads) ? saved.ads : []) state.record(ad);

  if (pageUrl && state.navigate(pageUrl)) {
    tabPageUrls.set(tabId, pageUrl);
  } else {
    tabPageUrls.set(tabId, pageUrl || savedPageUrl);
  }
  tabPageDetections.set(tabId, state);
  return state;
}

async function removeTabPageDetectionState(tabId: number) {
  tabPageDetections.delete(tabId);
  tabPageUrls.delete(tabId);
  const current = await chrome.storage.session.get(TAB_PAGE_DETECTIONS_SESSION_KEY);
  const stored = { ...(current[TAB_PAGE_DETECTIONS_SESSION_KEY] || {}) };
  delete stored[String(tabId)];
  await chrome.storage.session.set({ [TAB_PAGE_DETECTIONS_SESSION_KEY]: stored });
}

function recordTabPageDetection(message: any, sender: chrome.runtime.MessageSender) {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return Promise.resolve();

  return enqueueTabDetectionWrite(async () => {
    const pageUrl = message.pageUrl || sender.tab?.url || "";
    const state = await restoreTabPageDetectionState(tabId, pageUrl);
    if (pageUrl) tabPageUrls.set(tabId, pageUrl);
    const url = message.adUrl || message.sourceUrl || message.blockedTargetUrl || "";
    const added = state.record({
      id: url || `${message.adDomain || "blocked"}:${state.count() + 1}`,
      url,
      domain: message.adDomain || "",
      method: message.detectionMethod || message.method || "Blocked by protection",
      isHidden: true,
      canToggle: false,
    });
    if (added) await persistTabPageDetectionState(tabId, state);
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "loading" && !changeInfo.url) return;
  enqueueTabDetectionWrite(async () => {
    const nextUrl = changeInfo.url || tab.url || "";
    const state = await restoreTabPageDetectionState(tabId, nextUrl);
    if (changeInfo.status === "loading") state.reset(nextUrl);
    else if (changeInfo.url) state.navigate(nextUrl);
    tabPageUrls.set(tabId, nextUrl);
    await persistTabPageDetectionState(tabId, state);
  }).catch((error) => console.warn("[AdBlocker] Failed to reset page detection state:", error));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueueTabDetectionWrite(() => removeTabPageDetectionState(tabId))
    .catch((error) => console.warn("[AdBlocker] Failed to remove page detection state:", error));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "activateFullProtectionOnTab" && Number.isInteger(message.tabId)) {
    chrome.scripting.executeScript({
      target: { tabId: message.tabId, allFrames: true },
      files: ["runtime/report-bridge.js"],
      world: "ISOLATED",
    }).catch((error) => console.warn("[AdBlocker] Failed to activate report bridge:", error));
    return false;
  }

  if (message.type === "adBlocked") {
    recordTabPageDetection(message, sender)
      .catch((error) => console.warn("[AdBlocker] Failed to record page detection:", error));
    reportMessage(message).catch((error) => console.warn("[AdBlocker] Failed to record report event:", error));
    return false;
  }

  if (message.type === "protectionBlocked") {
    Promise.all([
      recordTabPageDetection(message, sender),
      reportMessage(message),
    ])
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: String(error) }));
    return true;
  }

  if (message.type === "getTabDetectionState" && Number.isInteger(message.tabId)) {
    enqueueTabDetectionWrite(async () => {
      const state = await restoreTabPageDetectionState(message.tabId, message.pageUrl || "");
      if (message.pageUrl) tabPageUrls.set(message.tabId, message.pageUrl);
      await persistTabPageDetectionState(message.tabId, state);
      sendResponse({ success: true, count: state.count(), ads: state.list() });
    }).catch((error) => sendResponse({ success: false, error: String(error) }));
    return true;
  }

  if (message.type === "getReportData") {
    readReportData(message.range || "30d")
      .then((data) => sendResponse({ success: true, data }))
      .catch((error) => sendResponse({ success: false, error: String(error) }));
    return true;
  }

  if (message.type === "clearReportData") {
    clearReportData()
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: String(error) }));
    return true;
  }

  if (message.type === "exportReportData") {
    exportReportData(message.format || "json", message.range || "all")
      .then((content) => sendResponse({ success: true, content, format: message.format || "json" }))
      .catch((error) => sendResponse({ success: false, error: String(error) }));
    return true;
  }

  return false;
});
