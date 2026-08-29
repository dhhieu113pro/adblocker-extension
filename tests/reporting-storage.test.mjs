import test from "node:test";
import assert from "node:assert/strict";
import {
  createReportStore,
} from "../src/reporting-storage.ts";
import {
  REPORT_EVENTS_KEY,
  REPORT_DAILY_KEY,
  REPORT_CATEGORY_CACHE_KEY,
} from "../src/reporting.mjs";

function createStorage(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) {
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(requested.map((key) => [key, structuredClone(data[key])]));
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) data[key] = structuredClone(value);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    },
  };
}

test("records normalized events and daily aggregates", async () => {
  const now = Date.UTC(2026, 7, 29, 12);
  const storage = createStorage();
  const store = createReportStore(storage);

  await store.record({
    pageUrl: "https://www.youtube.com/watch?v=secret",
    sourceUrl: "https://ads.example.net/banner?id=secret",
    blockType: "ad",
    detectionMethod: "ai",
    resourceType: "image",
  }, now);

  assert.equal(storage.data[REPORT_EVENTS_KEY].length, 1);
  assert.deepEqual(storage.data[REPORT_EVENTS_KEY][0], {
    timestamp: now,
    pageDomain: "youtube.com",
    pageCategory: "Video/Streaming",
    sourceDomain: "ads.example.net",
    blockType: "ad",
    detectionMethod: "ai",
    resourceType: "image",
    blockedTargetDomain: "",
  });
  assert.equal(storage.data[REPORT_DAILY_KEY]["2026-08-29"].total, 1);
  assert.equal(storage.data[REPORT_CATEGORY_CACHE_KEY]["youtube.com"].category, "Video/Streaming");
  assert.equal(JSON.stringify(storage.data).includes("secret"), false);
});

test("serializes concurrent writes without losing counts", async () => {
  const now = Date.UTC(2026, 7, 29, 12);
  const storage = createStorage();
  const store = createReportStore(storage);

  await Promise.all([
    store.record({ pageUrl: "https://example.com/1", sourceUrl: "https://ads.test/a", blockType: "ad" }, now),
    store.record({ pageUrl: "https://example.com/2", sourceUrl: "https://ads.test/b", blockType: "ad" }, now + 1),
  ]);

  assert.equal(storage.data[REPORT_EVENTS_KEY].length, 2);
  assert.equal(storage.data[REPORT_DAILY_KEY]["2026-08-29"].total, 2);
});

test("recording prunes detailed events older than 30 days", async () => {
  const day = 86_400_000;
  const now = 40 * day;
  const storage = createStorage({
    [REPORT_EVENTS_KEY]: [{ timestamp: 1, pageDomain: "old.example" }],
    [REPORT_DAILY_KEY]: {},
  });
  const store = createReportStore(storage);

  await store.record({ pageUrl: "https://new.example/path", blockType: "ad" }, now);
  assert.equal(storage.data[REPORT_EVENTS_KEY].length, 1);
  assert.equal(storage.data[REPORT_EVENTS_KEY][0].pageDomain, "new.example");
});

test("reads filtered data and exports CSV or JSON", async () => {
  const now = Date.UTC(2026, 7, 29, 12);
  const storage = createStorage();
  const store = createReportStore(storage);
  await store.record({ pageUrl: "https://example.com", blockType: "popup", blockedTargetUrl: "https://blocked.test/private?q=x", resourceType: "popup" }, now);

  const report = await store.read("today", now);
  assert.equal(report.events.length, 1);
  assert.equal(report.events[0].blockedTargetDomain, "blocked.test");

  const csv = await store.export("csv", "all", now);
  assert.match(csv, /^timestamp,pageDomain,pageCategory,/);
  const json = JSON.parse(await store.export("json", "all", now));
  assert.equal(json.version, 1);
  assert.equal(json.events[0].blockedTargetDomain, "blocked.test");
});

test("clear removes only report-owned keys", async () => {
  const storage = createStorage({
    [REPORT_EVENTS_KEY]: [{ timestamp: 1 }],
    [REPORT_DAILY_KEY]: { day: { total: 1 } },
    [REPORT_CATEGORY_CACHE_KEY]: { "example.com": { category: "Other" } },
    adBlockHistory: [{ url: "keep" }],
    unrelatedLocalSetting: true,
  });
  const store = createReportStore(storage);

  await store.clear();

  assert.equal(REPORT_EVENTS_KEY in storage.data, false);
  assert.equal(REPORT_DAILY_KEY in storage.data, false);
  assert.equal(REPORT_CATEGORY_CACHE_KEY in storage.data, false);
  assert.deepEqual(storage.data.adBlockHistory, [{ url: "keep" }]);
  assert.equal(storage.data.unrelatedLocalSetting, true);
});
