import test from "node:test";
import assert from "node:assert/strict";
import {
  buildProtectionMix,
  DEFAULT_PROTECTION_MIX_RANGE,
  PROTECTION_MIX_RANGES,
} from "../src/popup-report-summary.mjs";

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

test("protection mix ranges default to weekly rolling data", () => {
  assert.equal(DEFAULT_PROTECTION_MIX_RANGE, "7d");
  assert.deepEqual(PROTECTION_MIX_RANGES, [
    { label: "Weekly", value: "7d" },
    { label: "Monthly", value: "30d" },
    { label: "Yearly", value: "365d" },
    { label: "All", value: "all" },
  ]);
});
