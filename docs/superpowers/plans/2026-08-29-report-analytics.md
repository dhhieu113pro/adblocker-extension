# Report Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-only analytics Report page showing blocked ads, trackers, popups, sites, categories, sources, detection methods, resource types, and recent activity.

**Architecture:** Add pure reporting/category modules with small storage-facing adapters, integrate them at the existing background message boundary, and render a dedicated extension page opened from the popup. Detailed normalized events expire after 30 days while compact daily aggregates remain until explicitly cleared.

**Tech Stack:** Manifest V3, TypeScript/JavaScript, Chrome Extension APIs, `chrome.storage.local`, Parcel 2, Node `node:test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-29-report-analytics-design.md`

## Global Constraints
- Report analytics is local-only.
- Persist normalized domains only; never persist page titles, query strings, URL fragments, or full browsing URLs in report storage.
- Detailed report events expire after 30 days.
- Daily aggregate statistics remain until Clear Statistics.
- Keep the existing `adBlockHistory` popup behavior intact.
- Remain Manifest V3 and Chromium-compatible.
- Do not add an analytics/network permission or telemetry dependency.
- Do not ship estimated bandwidth/time savings or Protection Score in this release.

---

### Task 1: Site category classifier

**Files:**
- Create: `src/site-category.mjs`
- Create: `tests/site-category.test.mjs`

**Interfaces:**
- Produces: `normalizeDomain(value: string): string`, `classifySite(input: { url?: string, domain?: string, metadata?: string }): { category: string, confidence: number, source: "offline" | "heuristic" | "fallback" }`.

- [ ] **Step 1: Write failing category tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDomain, classifySite } from "../src/site-category.mjs";

test("normalizes URLs without retaining path/query", () => {
  assert.equal(normalizeDomain("https://news.ycombinator.com/item?id=1#x"), "news.ycombinator.com");
});

test("classifies known and heuristic sites", () => {
  assert.equal(classifySite({ domain: "youtube.com" }).category, "Video/Streaming");
  assert.equal(classifySite({ domain: "shop-example.test", metadata: "products cart checkout" }).category, "Shopping");
  assert.equal(classifySite({ domain: "unknown-example.test" }).category, "Other");
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test tests/site-category.test.mjs`
Expected: FAIL because `src/site-category.mjs` does not exist.

- [ ] **Step 3: Implement the classifier**

Implement a small offline map for high-confidence domains, keyword groups for the approved categories, URL/domain normalization using `URL`, and deterministic heuristic scoring. Return `Other` with low confidence when no signal reaches the threshold. Do not perform network calls.

- [ ] **Step 4: Run tests**

Run: `node --test tests/site-category.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/site-category.mjs tests/site-category.test.mjs
git commit -m "feat: add offline site category classifier"
```

### Task 2: Reporting storage and aggregation core

**Files:**
- Create: `src/reporting.mjs`
- Create: `tests/reporting.test.mjs`

**Interfaces:**
- Consumes: `normalizeDomain()` from `site-category.mjs`.
- Produces: `normalizeReportEvent(input, now)`, `pruneEvents(events, now)`, `aggregateEvent(aggregates, event)`, `filterReportData(data, range, now)`, `buildCsv(data)`, `buildJson(data)`, and storage key constants.

- [ ] **Step 1: Write failing privacy/aggregation tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeReportEvent, pruneEvents, aggregateEvent } from "../src/reporting.mjs";

test("report events persist domains rather than full URLs", () => {
  const event = normalizeReportEvent({
    timestamp: 1000,
    pageUrl: "https://example.com/private?q=secret#x",
    sourceUrl: "https://ads.example.net/a.js?id=42",
    blockType: "ad",
    detectionMethod: "network",
    resourceType: "script"
  }, 1000);
  assert.equal(event.pageDomain, "example.com");
  assert.equal(event.sourceDomain, "ads.example.net");
  assert.equal(JSON.stringify(event).includes("secret"), false);
});

test("prunes detailed events older than 30 days", () => {
  const day = 86_400_000;
  assert.deepEqual(pruneEvents([{ timestamp: 1 }], 31 * day), []);
});

test("aggregates by UTC day and dimensions", () => {
  const event = { timestamp: Date.UTC(2026, 7, 29), pageDomain: "example.com", pageCategory: "News", sourceDomain: "ads.test", blockType: "ad", detectionMethod: "ai", resourceType: "image" };
  const result = aggregateEvent({}, event);
  assert.equal(result["2026-08-29"].total, 1);
  assert.equal(result["2026-08-29"].detectionMethods.ai, 1);
});
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/reporting.test.mjs`
Expected: FAIL because reporting module does not exist.

- [ ] **Step 3: Implement minimal reporting core**

Use storage keys `reportEventsV1`, `reportDailyV1`, and `reportCategoryCacheV1`. Validate enums, normalize domains, use an ISO `YYYY-MM-DD` bucket, prune detailed events at `30 * 24 * 60 * 60 * 1000`, and aggregate counters for sites/categories/sources/blockTypes/detectionMethods/resourceTypes.

- [ ] **Step 4: Add range/export/clear-shape tests and implementation**

Test Today/7d/30d/All filtering and verify CSV headers are exactly `timestamp,pageDomain,pageCategory,sourceDomain,blockType,detectionMethod,resourceType,blockedTargetDomain`. JSON export must contain `version`, `exportedAt`, `events`, and `daily`.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/reporting.test.mjs tests/site-category.test.mjs`
Expected: PASS.

```bash
git add src/reporting.mjs tests/reporting.test.mjs
git commit -m "feat: add local report aggregation"
```

### Task 3: Background integration and report API

**Files:**
- Modify: `src/background.ts`
- Create: `src/reporting-storage.ts`
- Create: `tests/reporting-storage.test.mjs`

**Interfaces:**
- Consumes: reporting core and category classifier.
- Produces background messages: `getReportData`, `clearReportData`, `exportReportData`, plus recording through the existing `adBlocked` path.

- [ ] **Step 1: Write failing adapter tests**

Create a fake storage adapter and assert one recorded event writes a pruned detailed list plus updated daily aggregates; clearing deletes all three report keys without touching `adBlockHistory` or sync settings.

- [ ] **Step 2: Run the focused test**

Run: `node --test tests/reporting-storage.test.mjs`
Expected: FAIL until the adapter exists.

- [ ] **Step 3: Implement `reporting-storage.ts`**

Expose `recordReportEvent`, `readReportData`, `clearReportData`, and `exportReportData`. Serialize writes through one promise chain to prevent concurrent service-worker messages from losing increments.

- [ ] **Step 4: Integrate `background.ts`**

In the existing `adBlocked` handler, retain badge and `adBlockHistory` behavior, then record normalized report metadata. Extend content/inject message metadata only where required to distinguish `blockType`, `detectionMethod`, and `resourceType`. Add message handlers for report read/clear/export operations.

- [ ] **Step 5: Verify and commit**

Run: `npm test`
Expected: all Node tests PASS.

```bash
git add src/background.ts src/reporting-storage.ts tests/reporting-storage.test.mjs
git commit -m "feat: record privacy-safe report events"
```

### Task 4: Dedicated Report dashboard

**Files:**
- Create: `src/report.html`
- Create: `src/report.ts`
- Create: `src/report.css`
- Modify: `src/manifest.json` only if Parcel requires explicit extension-page inclusion.
- Create: `tests/report-page.test.mjs`

**Interfaces:**
- Consumes: background `getReportData`, `clearReportData`, `exportReportData` messages.

- [ ] **Step 1: Add failing report rendering tests**

Test pure view-model helpers for KPI totals, trend rows, top-site sorting, category/source/detection/resource distributions, and empty state. A zero-data report must render all KPI values as `0` and show a privacy/local-only notice.

- [ ] **Step 2: Implement dashboard structure**

Create accessible semantic sections for filters, KPI cards, blocking trend, websites, categories, sources, detection methods, resource types, and recent activity. Use lightweight CSS bars/tables rather than introducing a chart dependency.

- [ ] **Step 3: Implement interactions**

Time filters send/read local report data; recent activity supports text filtering; Clear Statistics requires confirmation; CSV/JSON export creates a Blob and downloads it. Popup blocked-target action opens `https://${blockedTargetDomain}/` in a new tab and never reconstructs a path/query.

- [ ] **Step 4: Run unit/build checks**

Run: `npm test && npm run build`
Expected: PASS and Parcel emits the report page/assets.

- [ ] **Step 5: Commit**

```bash
git add src/report.html src/report.ts src/report.css src/manifest.json tests/report-page.test.mjs
git commit -m "feat: add protection report dashboard"
```

### Task 5: Popup entry point

**Files:**
- Modify: `src/popup.html`
- Modify: `src/popup.ts`
- Modify: `src/popup.css`

**Interfaces:**
- Produces: a Reports/Analytics action opening `chrome.runtime.getURL("report.html")` in a new tab.

- [ ] **Step 1: Add the Reports action**

Place it with the popup's primary navigation/actions, with accessible text and keyboard focus styling.

- [ ] **Step 2: Wire navigation**

Use `chrome.tabs.create({ url: chrome.runtime.getURL("report.html") })`; do not request additional permissions.

- [ ] **Step 3: Build and manually smoke-test**

Run: `npm run build`
Expected: PASS. Load unpacked `dist`, open popup, activate Reports, and verify the dashboard opens.

- [ ] **Step 4: Commit**

```bash
git add src/popup.html src/popup.ts src/popup.css
git commit -m "feat: open reports from popup"
```

### Task 6: Browser-level privacy and report flows

**Files:**
- Create: `tests/report.spec.mjs`
- Modify: `playwright.config.mjs` only if the existing extension fixture needs the new page.

**Interfaces:**
- Exercises the built extension and report page end-to-end.

- [ ] **Step 1: Add Playwright scenarios**

Cover opening the Report page, changing range, rendering seeded local aggregates, clearing statistics, and verifying an event seeded with full input URLs renders domains only. Assert the report DOM does not contain seeded query secrets.

- [ ] **Step 2: Run E2E**

Run: `npm run build && npm run test:e2e`
Expected: PASS.

- [ ] **Step 3: Run complete verification**

Run: `npm test && npm run build && npm run test:e2e`
Expected: all commands PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/report.spec.mjs playwright.config.mjs
git commit -m "test: cover report analytics flows"
```

### Task 7: Documentation and final verification

**Files:**
- Modify: `README.md`
- Modify: `PRIVACY.md`

**Interfaces:**
- Documents the shipped local-only analytics behavior and retention policy.

- [ ] **Step 1: Update README**

Document Report features, time ranges, export/clear controls, and explicitly state that report statistics stay on the device.

- [ ] **Step 2: Update privacy documentation**

State that report events store normalized domains and metadata locally for up to 30 days, aggregates persist locally until cleared, and report analytics is not transmitted.

- [ ] **Step 3: Run final verification**

Run: `npm test && npm run build && npm run test:e2e`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md PRIVACY.md
git commit -m "docs: document local report analytics"
```
