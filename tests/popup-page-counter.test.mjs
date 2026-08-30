import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const popup = await readFile(new URL("../src/popup.ts", import.meta.url), "utf8");
const reportingBackground = await readFile(new URL("../src/reporting-background.ts", import.meta.url), "utf8");

test("reporting background owns a deduplicated per-tab page detection state", () => {
  assert.match(reportingBackground, /createPageDetectionState/);
  assert.match(reportingBackground, /tabPageDetections/);
  assert.match(reportingBackground, /message\.type === ["']getTabDetectionState["']/);
  assert.match(reportingBackground, /chrome\.tabs\.onUpdated\.addListener/);
  assert.match(reportingBackground, /chrome\.tabs\.onRemoved\.addListener/);
});

test("page detection state survives MV3 service-worker suspension in session storage", () => {
  assert.match(reportingBackground, /chrome\.storage\.session/);
  assert.match(reportingBackground, /restoreTabPageDetectionState/);
  assert.match(reportingBackground, /persistTabPageDetectionState/);
});

test("popup uses the page detection state for the Overview counter", () => {
  assert.match(popup, /getTabDetectionState/);
  assert.match(popup, /mergePageDetections/);
  assert.match(popup, /pageDetectionCount/);
  assert.match(popup, /Math\.max\(pageDetectionCount,\s*ads\.length\)/);
});
