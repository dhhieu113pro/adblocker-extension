import "./background";
import {
  clearReportData,
  exportReportData,
  readReportData,
  recordReportEvent,
} from "./reporting-storage";

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "activateFullProtectionOnTab" && Number.isInteger(message.tabId)) {
    chrome.scripting.executeScript({
      target: { tabId: message.tabId, allFrames: true },
      files: ["runtime/report-bridge.js"],
      world: "ISOLATED",
    }).catch((error) => console.warn("[AdBlocker] Failed to activate report bridge:", error));
    return false;
  }

  if (message.type === "adBlocked") {
    reportMessage(message).catch((error) => console.warn("[AdBlocker] Failed to record report event:", error));
    return false;
  }

  if (message.type === "protectionBlocked") {
    reportMessage(message)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: String(error) }));
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
