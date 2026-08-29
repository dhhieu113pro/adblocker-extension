import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const background = await readFile(new URL("../src/background.ts", import.meta.url), "utf8");
const content = await readFile(new URL("../src/content.js", import.meta.url), "utf8");
const inject = await readFile(new URL("../src/inject.ts", import.meta.url), "utf8");

test("background records ad blocks and serves report API messages", () => {
  assert.match(background, /from ["']\.\/reporting-storage["']/);
  assert.match(background, /recordReportEvent\(/);
  assert.match(background, /message\.type === ["']getReportData["']/);
  assert.match(background, /message\.type === ["']clearReportData["']/);
  assert.match(background, /message\.type === ["']exportReportData["']/);
});

test("content forwards detection metadata with ad block events", () => {
  assert.match(content, /detectionMethod/);
  assert.match(content, /resourceType/);
});

test("popup blocks are bridged from MAIN world to background analytics", () => {
  assert.match(inject, /aiVisionPopupBlocked/);
  assert.match(content, /aiVisionPopupBlocked/);
  assert.match(content, /blockType:\s*["']popup["']/);
  assert.match(content, /blockedTargetUrl/);
});
