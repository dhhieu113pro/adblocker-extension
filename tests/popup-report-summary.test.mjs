import test from "node:test";
import assert from "node:assert/strict";
import { buildProtectionMix } from "../src/popup-report-summary.mjs";

test("buildProtectionMix converts report KPIs into donut percentages", () => {
  const mix = buildProtectionMix({ adsBlocked: 6, trackersBlocked: 3, popupsBlocked: 1 });

  assert.deepEqual(mix, {
    ads: 6,
    trackers: 3,
    popups: 1,
    total: 10,
    adsEnd: 60,
    trackersEnd: 90,
  });
});

test("buildProtectionMix keeps an empty report at zero", () => {
  assert.deepEqual(buildProtectionMix({ adsBlocked: 0, trackersBlocked: 0, popupsBlocked: 0 }), {
    ads: 0,
    trackers: 0,
    popups: 0,
    total: 0,
    adsEnd: 0,
    trackersEnd: 0,
  });
});
