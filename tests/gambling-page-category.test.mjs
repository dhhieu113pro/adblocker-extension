import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const offscreenSource = fs.readFileSync(new URL("../src/offscreen.ts", import.meta.url), "utf8");
const backgroundSource = fs.readFileSync(new URL("../src/background.ts", import.meta.url), "utf8");

test("whole-page CLIP classification includes a gambling website candidate", () => {
  assert.match(
    offscreenSource,
    /clipClassifyWebsite[\s\S]*?candidate_labels = \[[\s\S]*?sports betting or online casino gambling website[\s\S]*?\];/,
  );
});

test("whole-page CLIP results map gambling labels to Gambling\/Betting", () => {
  assert.match(backgroundSource, /Gambling\/Betting/);
  assert.match(backgroundSource, /topMatch\.label\.includes\("gambling"\)/);
});
