import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const popup = await readFile(new URL("../src/popup.html", import.meta.url), "utf8");

test("popup exposes a direct Report link that Parcel can discover", () => {
  assert.match(popup, /href=["']report\.html["']/);
  assert.match(popup, />\s*Reports\s*</);
  assert.match(popup, /target=["']_blank["']/);
});
