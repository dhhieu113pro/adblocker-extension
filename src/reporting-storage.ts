import {
  REPORT_EVENTS_KEY,
  REPORT_DAILY_KEY,
  REPORT_CATEGORY_CACHE_KEY,
  normalizeReportEvent,
  pruneEvents,
  aggregateEvent,
  filterReportData,
  buildCsv,
  buildJson,
} from "./reporting.mjs";
import { classifySite, normalizeDomain } from "./site-category.mjs";

const DUPLICATE_EVENT_WINDOW_MS = 1_000;

function duplicateSignature(input, event) {
  return JSON.stringify([
    String(input.pageUrl || input.pageDomain || ""),
    String(input.sourceUrl || input.adUrl || input.blockedTargetUrl || ""),
    String(input.blockedTargetUrl || ""),
    event.blockType,
    event.detectionMethod,
    event.resourceType,
  ]);
}

export function createReportStore(storage = chrome.storage.local) {
  let writeChain = Promise.resolve();
  const recentEventSignatures = new Map();

  async function load(keys) {
    return storage.get(keys);
  }

  function enqueueWrite(operation) {
    const next = writeChain.then(operation, operation);
    writeChain = next.catch(() => undefined);
    return next;
  }

  async function resolveCategory(input, cache) {
    const pageDomain = normalizeDomain(input.pageDomain || input.pageUrl || "");
    if (!pageDomain) return { category: "Other", confidence: 0, source: "fallback" };

    const cached = cache[pageDomain];
    if (cached?.category) return cached;

    const result = classifySite({
      domain: pageDomain,
      metadata: input.pageMetadata || "",
    });
    cache[pageDomain] = result;
    return result;
  }

  function record(input = {}, now = Date.now()) {
    return enqueueWrite(async () => {
      const current = await load([REPORT_EVENTS_KEY, REPORT_DAILY_KEY, REPORT_CATEGORY_CACHE_KEY]);
      const categoryCache = { ...(current[REPORT_CATEGORY_CACHE_KEY] || {}) };
      const category = await resolveCategory(input, categoryCache);
      const event = normalizeReportEvent({
        ...input,
        pageCategory: input.pageCategory || category.category,
        timestamp: Number.isFinite(Number(input.timestamp)) ? Number(input.timestamp) : now,
      }, now);

      const signature = duplicateSignature(input, event);
      const previousTimestamp = recentEventSignatures.get(signature);
      const elapsed = Number(event.timestamp) - Number(previousTimestamp);
      if (Number.isFinite(previousTimestamp) && elapsed >= 0 && elapsed <= DUPLICATE_EVENT_WINDOW_MS) {
        return event;
      }

      const storedEvents = current[REPORT_EVENTS_KEY] || [];
      const events = pruneEvents([...storedEvents, event], now);
      const daily = aggregateEvent(current[REPORT_DAILY_KEY] || {}, event);

      await storage.set({
        [REPORT_EVENTS_KEY]: events,
        [REPORT_DAILY_KEY]: daily,
        [REPORT_CATEGORY_CACHE_KEY]: categoryCache,
      });

      recentEventSignatures.set(signature, Number(event.timestamp));
      const cutoff = Number(event.timestamp) - DUPLICATE_EVENT_WINDOW_MS;
      for (const [key, timestamp] of recentEventSignatures) {
        if (Number(timestamp) < cutoff) recentEventSignatures.delete(key);
      }

      return event;
    });
  }

  function read(range = "30d", now = Date.now()) {
    return enqueueWrite(async () => {
      const current = await load([REPORT_EVENTS_KEY, REPORT_DAILY_KEY]);
      const storedEvents = Array.isArray(current[REPORT_EVENTS_KEY]) ? current[REPORT_EVENTS_KEY] : [];
      const events = pruneEvents(storedEvents, now);
      if (events.length !== storedEvents.length) {
        await storage.set({ [REPORT_EVENTS_KEY]: events });
      }
      return filterReportData({
        events,
        daily: current[REPORT_DAILY_KEY] || {},
      }, range, now);
    });
  }

  async function exportData(format = "json", range = "all", now = Date.now()) {
    const data = await read(range, now);
    return format === "csv" ? buildCsv(data) : buildJson(data, now);
  }

  function clear() {
    recentEventSignatures.clear();
    return enqueueWrite(() => storage.remove([
      REPORT_EVENTS_KEY,
      REPORT_DAILY_KEY,
      REPORT_CATEGORY_CACHE_KEY,
    ]));
  }

  return {
    record,
    read,
    export: exportData,
    clear,
  };
}

let defaultStore;

function getDefaultStore() {
  if (!defaultStore) defaultStore = createReportStore();
  return defaultStore;
}

export function recordReportEvent(input, now) {
  return getDefaultStore().record(input, now);
}

export function readReportData(range, now) {
  return getDefaultStore().read(range, now);
}

export function exportReportData(format, range, now) {
  return getDefaultStore().export(format, range, now);
}

export function clearReportData() {
  return getDefaultStore().clear();
}
