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

function isDuplicateEvent(events, event) {
  const previous = Array.isArray(events) ? events.at(-1) : null;
  if (!previous) return false;

  const elapsed = Number(event.timestamp) - Number(previous.timestamp);
  if (elapsed < 0 || elapsed > DUPLICATE_EVENT_WINDOW_MS) return false;

  return previous.pageDomain === event.pageDomain
    && previous.pageCategory === event.pageCategory
    && previous.sourceDomain === event.sourceDomain
    && previous.blockType === event.blockType
    && previous.detectionMethod === event.detectionMethod
    && previous.resourceType === event.resourceType
    && previous.blockedTargetDomain === event.blockedTargetDomain;
}

export function createReportStore(storage = chrome.storage.local) {
  let writeChain = Promise.resolve();

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

      const storedEvents = current[REPORT_EVENTS_KEY] || [];
      if (isDuplicateEvent(storedEvents, event)) return storedEvents.at(-1);

      const events = pruneEvents([...storedEvents, event], now);
      const daily = aggregateEvent(current[REPORT_DAILY_KEY] || {}, event);

      await storage.set({
        [REPORT_EVENTS_KEY]: events,
        [REPORT_DAILY_KEY]: daily,
        [REPORT_CATEGORY_CACHE_KEY]: categoryCache,
      });

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
