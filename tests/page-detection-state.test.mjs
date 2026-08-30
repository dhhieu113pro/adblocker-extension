import test from "node:test";
import assert from "node:assert/strict";
import { createPageDetectionState } from "../src/page-detection-state.mjs";

function ad(overrides = {}) {
  return {
    id: "ad_1",
    url: "https://ads.example/banner.jpg?slot=top",
    domain: "ads.example",
    width: 728,
    height: 90,
    confidence: 95,
    method: "AI vision",
    reasons: ["classified as advertisement"],
    isHidden: true,
    ...overrides,
  };
}

test("counts repeated detection of the same ad only once on the current page", () => {
  const state = createPageDetectionState("https://gamek.vn/");

  assert.equal(state.record(ad()), true);
  assert.equal(state.record(ad({ id: "ad_2" })), false);
  assert.equal(state.record(ad({ id: "ad_3" })), false);

  assert.equal(state.count(), 1);
  assert.equal(state.list().length, 1);
});

test("increments for a genuinely different ad on the same page", () => {
  const state = createPageDetectionState("https://gamek.vn/");

  state.record(ad());
  state.record(ad({
    id: "ad_2",
    url: "https://ads.example/sidebar.jpg?slot=right",
    width: 300,
    height: 250,
  }));

  assert.equal(state.count(), 2);
  assert.equal(state.list().length, 2);
});

test("resets on real navigation but not a hash-only change", () => {
  const state = createPageDetectionState("https://gamek.vn/news.html#top");
  state.record(ad());

  assert.equal(state.navigate("https://gamek.vn/news.html#comments"), false);
  assert.equal(state.count(), 1);

  assert.equal(state.navigate("https://gamek.vn/review.html"), true);
  assert.equal(state.count(), 0);
  assert.deepEqual(state.list(), []);
});
