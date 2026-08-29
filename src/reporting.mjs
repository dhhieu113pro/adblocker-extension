import { normalizeDomain } from "./site-category.mjs";

export const REPORT_EVENTS_KEY = "reportEventsV1";
export const REPORT_DAILY_KEY = "reportDailyV1";
export const REPORT_CATEGORY_CACHE_KEY = "reportCategoryCacheV1";

const DETAIL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const BLOCK_TYPES = new Set(["ad", "tracker", "popup"]);
const DETECTION_METHODS = new Set(["network", "heuristic", "ai"]);
const RESOURCE_TYPES = new Set(["image", "video", "banner", "overlay", "popup", "script", "pixel", "iframe", "other"]);

function safeEnum(value, allowed, fallback) {
  return allowed.has(value) ? value : fallback;
}

export function normalizeReportEvent(input = {}, now = Date.now()) {
  const timestamp = Number.isFinite(Number(input.timestamp)) ? Number(input.timestamp) : now;
  return {
    timestamp,
    pageDomain: normalizeDomain(input.pageDomain || input.pageUrl || ""),
    pageCategory: String(input.pageCategory || "Other"),
    sourceDomain: normalizeDomain(input.sourceDomain || input.sourceUrl || ""),
    blockType: safeEnum(input.blockType, BLOCK_TYPES, "ad"),
    detectionMethod: safeEnum(input.detectionMethod, DETECTION_METHODS, "heuristic"),
    resourceType: safeEnum(input.resourceType, RESOURCE_TYPES, "other"),
    blockedTargetDomain: normalizeDomain(input.blockedTargetDomain || input.blockedTargetUrl || ""),
  };
}

export function pruneEvents(events, now = Date.now()) {
  const cutoff = now - DETAIL_RETENTION_MS;
  return (Array.isArray(events) ? events : []).filter((event) => Number(event?.timestamp) >= cutoff);
}

function increment(map, key) {
  if (!key) return;
  map[key] = (Number(map[key]) || 0) + 1;
}

function createDayBucket() {
  return {
    total: 0,
    sites: {},
    categories: {},
    sources: {},
    blockTypes: {},
    detectionMethods: {},
    resourceTypes: {},
  };
}

export function aggregateEvent(aggregates = {}, event) {
  const next = { ...aggregates };
  const dayKey = new Date(Number(event.timestamp)).toISOString().slice(0, 10);
  const previous = next[dayKey] || createDayBucket();
  const bucket = {
    total: Number(previous.total) || 0,
    sites: { ...(previous.sites || {}) },
    categories: { ...(previous.categories || {}) },
    sources: { ...(previous.sources || {}) },
    blockTypes: { ...(previous.blockTypes || {}) },
    detectionMethods: { ...(previous.detectionMethods || {}) },
    resourceTypes: { ...(previous.resourceTypes || {}) },
  };

  bucket.total += 1;
  increment(bucket.sites, event.pageDomain);
  increment(bucket.categories, event.pageCategory);
  increment(bucket.sources, event.sourceDomain);
  increment(bucket.blockTypes, event.blockType);
  increment(bucket.detectionMethods, event.detectionMethod);
  increment(bucket.resourceTypes, event.resourceType);
  next[dayKey] = bucket;
  return next;
}

function startOfUtcDay(timestamp) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function rangeCutoff(range, now) {
  if (range === "today") return startOfUtcDay(now);
  if (range === "7d") return now - 7 * 24 * 60 * 60 * 1000;
  if (range === "30d") return now - 30 * 24 * 60 * 60 * 1000;
  return Number.NEGATIVE_INFINITY;
}

export function filterReportData(data = {}, range = "30d", now = Date.now()) {
  const cutoff = rangeCutoff(range, now);
  const events = (Array.isArray(data.events) ? data.events : []).filter((event) => Number(event?.timestamp) >= cutoff);
  const daily = Object.fromEntries(
    Object.entries(data.daily || {}).filter(([day]) => {
      if (range === "all") return true;
      const dayTimestamp = Date.parse(`${day}T00:00:00.000Z`);
      return Number.isFinite(dayTimestamp) && dayTimestamp >= startOfUtcDay(cutoff);
    }),
  );
  return { events, daily };
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildCsv(data = {}) {
  const fields = [
    "timestamp",
    "pageDomain",
    "pageCategory",
    "sourceDomain",
    "blockType",
    "detectionMethod",
    "resourceType",
    "blockedTargetDomain",
  ];
  const rows = (Array.isArray(data.events) ? data.events : []).map((event) =>
    fields.map((field) => csvEscape(event?.[field])).join(","),
  );
  return [fields.join(","), ...rows].join("\n");
}

export function buildJson(data = {}, exportedAt = Date.now()) {
  return JSON.stringify({
    version: 1,
    exportedAt,
    events: Array.isArray(data.events) ? data.events : [],
    daily: data.daily || {},
  }, null, 2);
}
