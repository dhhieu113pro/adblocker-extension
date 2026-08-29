import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const htmlUrl = new URL("../src/report.html", import.meta.url);
const tsUrl = new URL("../src/report.ts", import.meta.url);
const cssUrl = new URL("../src/report.css", import.meta.url);

async function source(url) {
  return readFile(url, "utf8");
}

test("report page exposes privacy notice, ranges, KPI cards and report sections", async () => {
  const html = await source(htmlUrl);
  assert.match(html, /Protection Report/);
  assert.match(html, /Stays on this device/);
  for (const range of ["today", "7d", "30d", "all"]) assert.match(html, new RegExp(`data-range=["']${range}["']`));
  for (const id of ["kpi-ads", "kpi-trackers", "kpi-popups", "kpi-sites", "kpi-ai"]) assert.match(html, new RegExp(`id=["']${id}["']`));
  for (const id of ["trend", "websites", "categories", "sources", "methods", "resources", "recent"]) assert.match(html, new RegExp(`id=["']${id}["']`));
});

test("report UI requests data, supports export/clear, filtering and popup-domain open", async () => {
  const script = await source(tsUrl);
  assert.match(script, /getReportData/);
  assert.match(script, /exportReportData/);
  assert.match(script, /clearReportData/);
  assert.match(script, /filterRecentActivity/);
  assert.match(script, /blockedDomainUrl/);
  assert.match(script, /chrome\.tabs\.create/);
});

test("report styling is responsive and does not depend on a chart library", async () => {
  const css = await source(cssUrl);
  assert.match(css, /@media/);
  assert.match(css, /\.kpi-grid/);
  assert.match(css, /\.bar/);
});
