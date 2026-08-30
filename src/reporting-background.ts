import "./background";
import { createPageDetectionState } from "./page-detection-state.mjs";
import {
  clearReportData,
  exportReportData,
  readReportData,
  recordReportEvent,
} from "./reporting-storage";

const tabPageDetections = new Map<number, any>();

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

function getTabPageDetectionState(tabId: number, pageUrl = "") {
  let state = tabPageDetections.get(tabId);
  if (!state) {
    state = createPageDetectionState(pageUrl);
    tabPageDetections.set(tabId, state);
  } else if (pageUrl) {
    state.navigate(pageUrl);
  }
  return state;
}

function recordTabPageDetection(message: any, sender: chrome.runtime.MessageSender) {
  const tabId = sender.tab?.id;
  if (tabId === undefined) return;

  const pageUrl = message.pageUrl || sender.tab?.url || "";
  const state = getTabPageDetectionState(tabId, pageUrl);
  const url = message.adUrl || message.sourceUrl || message.blockedTargetUrl || "";
  state.record({
    id: url || `${message.adDomain || "blocked"}:${state.count() + 1}`,
    url,
    domain: message.adDomain || "",
    method: message.detectionMethod || message.method || "Blocked by protection",
    isHidden: true,
    canToggle: false,
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const state = tabPageDetections.get(tabId);
  if (!state) return;

  const nextUrl = changeInfo.url || tab.url || "";
  if (changeInfo.status === "loading") state.reset(nextUrl);
  else if (changeInfo.url) state.navigate(nextUrl);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabPageDetections.delete(tabId);
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
    recordTabPageDetection(message, sender);
    reportMessage(message).catch((error) => console.warn("[AdBlocker] Failed to record report event:", error));
    return false;
  }

  if (message.type === "protectionBlocked") {
    recordTabPageDetection(message, sender);
    reportMessage(message)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: String(error) }));
    return true;
  }

  if (message.type === "getTabDetectionState" && Number.isInteger(message.tabId)) {
    const state = getTabPageDetectionState(message.tabId, message.pageUrl || "");
    sendResponse({ success: true, count: state.count(), ads: state.list() });
    return false;
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
