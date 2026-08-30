import test from "node:test";
import assert from "node:assert/strict";
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
} from "../src/reporting.mjs";

const DAY = 86_400_000;

test("uses versioned storage keys", () => {
  assert.equal(REPORT_EVENTS_KEY, "reportEventsV1");
  assert.equal(REPORT_DAILY_KEY, "reportDailyV1");
  assert.equal(REPORT_CATEGORY_CACHE_KEY, "reportCategoryCacheV2");
});

test("report events persist domains rather than full URLs", () => {
  const event = normalizeReportEvent({
    timestamp: 1000,
    pageUrl: "https://example.com/private?q=secret#x",
    sourceUrl: "https://ads.example.net/a.js?id=42",
    blockedTargetUrl: "https://popup.example.org/path?token=hidden",
    pageCategory: "News",
    blockType: "ad",
    detectionMethod: "network",
    resourceType: "script",
  }, 1000);

  assert.equal(event.pageDomain, "example.com");
  assert.equal(event.sourceDomain, "ads.example.net");
  assert.equal(event.blockedTargetDomain, "popup.example.org");
  assert.equal(JSON.stringify(event).includes("secret"), false);
  assert.equal(JSON.stringify(event).includes("hidden"), false);
});

test("invalid enum values fall back safely", () => {
  const event = normalizeReportEvent({
    pageUrl: "https://example.com/",
    blockType: "wat",
    detectionMethod: "wat",
    resourceType: "wat",
  }, 123);
  assert.equal(event.blockType, "ad");
  assert.equal(event.detectionMethod, "heuristic");
  assert.equal(event.resourceType, "other");
});

test("prunes detailed events older than 30 days", () => {
  const now = 31 * DAY;
  assert.deepEqual(pruneEvents([{ timestamp: 1 }], now), []);
  assert.equal(pruneEvents([{ timestamp: now - 29 * DAY }], now).length, 1);
});

test("aggregates by local calendar day and dimensions", () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = "Asia/Ho_Chi_Minh";
  try {
    const event = {
      timestamp: Date.UTC(2026, 7, 29, 20),
      pageDomain: "example.com",
      pageCategory: "News",
      sourceDomain: "ads.test",
      blockType: "ad",
      detectionMethod: "ai",
      resourceType: "image",
    };
    const result = aggregateEvent({}, event);
    const day = result["2026-08-30"];
    assert.equal(day.total, 1);
    assert.equal(day.sites["example.com"], 1);
    assert.equal(day.categories.News, 1);
    assert.equal(day.sources["ads.test"], 1);
    assert.equal(day.blockTypes.ad, 1);
    assert.equal(day.detectionMethods.ai, 1);
    assert.equal(day.resourceTypes.image, 1);
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test("filters report events by supported time ranges", () => {
  const now = Date.UTC(2026, 7, 29, 12);
  const data = {
    events: [
      { timestamp: now - 2 * 60 * 60 * 1000 },
      { timestamp: now - 5 * DAY },
      { timestamp: now - 20 * DAY },
      { timestamp: now - 60 * DAY },
      { timestamp: now - 200 * DAY },
      { timestamp: now - 400 * DAY },
    ],
    daily: {},
  };
  assert.equal(filterReportData(data, "today", now).events.length, 1);
  assert.equal(filterReportData(data, "7d", now).events.length, 2);
  assert.equal(filterReportData(data, "30d", now).events.length, 3);
  assert.equal(filterReportData(data, "365d", now).events.length, 5);
  assert.equal(filterReportData(data, "all", now).events.length, 6);
});

test("exports stable CSV and JSON shapes", () => {
  const event = {
    timestamp: 123,
    pageDomain: "example.com",
    pageCategory: "News",
    sourceDomain: "ads.test",
    blockType: "ad",
    detectionMethod: "ai",
    resourceType: "image",
    blockedTargetDomain: "",
  };
  const data = { events: [event], daily: { "1970-01-01": { total: 1 } } };
  assert.equal(
    buildCsv(data).split("\n")[0],
    "timestamp,pageDomain,pageCategory,sourceDomain,blockType,detectionMethod,resourceType,blockedTargetDomain",
  );
  const parsed = JSON.parse(buildJson(data, 999));
  assert.equal(parsed.version, 1);
  assert.equal(parsed.exportedAt, 999);
  assert.deepEqual(parsed.events, [event]);
  assert.deepEqual(parsed.daily, data.daily);
});
