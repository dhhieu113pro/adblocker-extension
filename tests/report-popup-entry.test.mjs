import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const popup = await readFile(new URL("../src/popup.html", import.meta.url), "utf8");

test("popup exposes a prominent Report action that Parcel can discover", () => {
  assert.match(popup, /href=["']report\.html["']/);
  assert.match(popup, />\s*Reports\s*</);
  assert.match(popup, /target=["']_blank["']/);
  assert.match(popup, /class=["'][^"']*report-button[^"']*["']/);
});

test("overview exposes an accessible protection-mix donut", () => {
  assert.match(popup, /id=["']protection-mix-chart["']/);
  assert.match(popup, /role=["']img["']/);
  assert.match(popup, /id=["']protection-mix-total["']/);
  assert.match(popup, /id=["']protection-mix-ads["']/);
  assert.match(popup, /id=["']protection-mix-trackers["']/);
  assert.match(popup, /id=["']protection-mix-popups["']/);
});

test("overview protection mix exposes weekly, monthly, yearly, and all ranges", () => {
  assert.match(popup, /data-mix-range=["']7d["'][^>]*aria-pressed=["']true["'][^>]*>\s*Weekly\s*</);
  assert.match(popup, /data-mix-range=["']30d["'][^>]*>\s*Monthly\s*</);
  assert.match(popup, /data-mix-range=["']365d["'][^>]*>\s*Yearly\s*</);
  assert.match(popup, /data-mix-range=["']all["'][^>]*>\s*All\s*</);
});
