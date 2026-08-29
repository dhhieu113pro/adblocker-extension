import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const reportingBackground = await readFile(new URL("../src/reporting-background.ts", import.meta.url), "utf8");
const reportBridge = await readFile(new URL("../src/report-bridge.js", import.meta.url), "utf8");
const inject = await readFile(new URL("../src/inject.ts", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../src/manifest.json", import.meta.url), "utf8"));
const siteAccess = await readFile(new URL("../src/site-access.ts", import.meta.url), "utf8");
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("reporting background wraps the existing worker, records blocks, and serves report API messages", () => {
  assert.match(reportingBackground, /import ["']\.\/background["']/);
  assert.match(reportingBackground, /from ["']\.\/reporting-storage["']/);
  assert.match(reportingBackground, /recordReportEvent\(/);
  assert.match(reportingBackground, /message\.type === ["']getReportData["']/);
  assert.match(reportingBackground, /message\.type === ["']clearReportData["']/);
  assert.match(reportingBackground, /message\.type === ["']exportReportData["']/);
  assert.equal(manifest.background.service_worker, "reporting-background.ts");
});

test("popup blocks are bridged from MAIN world to local reporting", () => {
  assert.match(inject, /aiVisionPopupBlocked/);
  assert.match(reportBridge, /aiVisionPopupBlocked/);
  assert.match(reportBridge, /blockType:\s*["']popup["']/);
  assert.match(reportBridge, /blockedTargetUrl/);
  assert.match(siteAccess, /runtime\/report-bridge\.js/);
  assert.match(packageJson.scripts["build:runtime"], /src\/report-bridge\.js/);
});
