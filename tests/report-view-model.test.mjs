import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReportViewModel,
  filterRecentActivity,
  blockedDomainUrl,
} from "../src/report-view-model.mjs";

const data = {
  daily: {
    "2026-08-28": {
      total: 6,
      sites: { "video.example": 4, "news.example": 2 },
      categories: { "Video/Streaming": 4, News: 2 },
      sources: { "ads.example": 5, "tracker.example": 1 },
      blockTypes: { ad: 4, tracker: 1, popup: 1 },
      detectionMethods: { ai: 2, heuristic: 3, network: 1 },
      resourceTypes: { image: 3, iframe: 1, pixel: 1, popup: 1 },
    },
    "2026-08-29": {
      total: 4,
      sites: { "news.example": 3, "shop.example": 1 },
      categories: { News: 3, Shopping: 1 },
      sources: { "ads.example": 2, "shop-ads.example": 2 },
      blockTypes: { ad: 3, popup: 1 },
      detectionMethods: { ai: 1, heuristic: 1, network: 2 },
      resourceTypes: { image: 2, script: 1, popup: 1 },
    },
  },
  events: [
    { timestamp: 30, pageDomain: "shop.example", pageCategory: "Shopping", sourceDomain: "shop-ads.example", blockType: "popup", detectionMethod: "network", resourceType: "popup", blockedTargetDomain: "blocked.example" },
    { timestamp: 20, pageDomain: "news.example", pageCategory: "News", sourceDomain: "ads.example", blockType: "ad", detectionMethod: "ai", resourceType: "image", blockedTargetDomain: "" },
  ],
};

test("builds KPI totals from daily aggregates", () => {
  const vm = buildReportViewModel(data);
  assert.deepEqual(vm.kpis, {
    adsBlocked: 7,
    trackersBlocked: 1,
    popupsBlocked: 2,
    websitesProtected: 3,
    aiDetected: 3,
  });
});

test("ranks websites, categories, sources, methods and resource types", () => {
  const vm = buildReportViewModel(data);
  assert.deepEqual(vm.websites.map((item) => [item.name, item.count]), [
    ["news.example", 5],
    ["video.example", 4],
    ["shop.example", 1],
  ]);
  assert.deepEqual(vm.categories.slice(0, 2).map((item) => [item.name, item.count]), [["News", 5], ["Video/Streaming", 4]]);
  assert.deepEqual(vm.sources[0], { name: "ads.example", count: 7 });
  assert.equal(vm.detectionMethods.find((item) => item.name === "ai").count, 3);
  assert.equal(vm.resourceTypes.find((item) => item.name === "popup").count, 2);
  assert.deepEqual(vm.trend.map((item) => [item.day, item.total]), [["2026-08-28", 6], ["2026-08-29", 4]]);
});

test("sorts recent activity newest first and filters by visible fields", () => {
  const vm = buildReportViewModel(data);
  assert.deepEqual(vm.recent.map((item) => item.timestamp), [30, 20]);
  assert.equal(filterRecentActivity(vm.recent, "shop").length, 1);
  assert.equal(filterRecentActivity(vm.recent, "AI").length, 1);
  assert.equal(filterRecentActivity(vm.recent, "missing").length, 0);
});

test("reconstructs popup destination using domain only", () => {
  assert.equal(blockedDomainUrl("blocked.example"), "https://blocked.example/");
  assert.equal(blockedDomainUrl("https://blocked.example/private?q=secret"), "");
  assert.equal(blockedDomainUrl(""), "");
});

test("returns a stable empty dashboard", () => {
  const vm = buildReportViewModel({ daily: {}, events: [] });
  assert.deepEqual(vm.kpis, { adsBlocked: 0, trackersBlocked: 0, popupsBlocked: 0, websitesProtected: 0, aiDetected: 0 });
  assert.deepEqual(vm.websites, []);
  assert.deepEqual(vm.trend, []);
  assert.deepEqual(vm.recent, []);
});
