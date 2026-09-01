import test from "node:test";
import assert from "node:assert/strict";

import {
  findAdScore,
  shouldReviewWithSecondModel,
  chooseEnsembleResults,
} from "../src/vision-ensemble-policy.mjs";

test("extracts the strongest ad-like label score", () => {
  assert.equal(findAdScore([]), 0);
  assert.equal(findAdScore([{ label: "regular website photo", score: 0.9 }] ), 0);
  assert.equal(findAdScore([
    { label: "regular website photo", score: 0.7 },
    { label: "promotional ad banner", score: 0.42 },
    { label: "advertisement", score: 0.61 },
  ]), 0.61);
});

test("only ambiguous ad evidence invokes the second model", () => {
  assert.equal(shouldReviewWithSecondModel([{ label: "advertisement", score: 0.30 }]), false);
  assert.equal(shouldReviewWithSecondModel([{ label: "advertisement", score: 0.31 }]), true);
  assert.equal(shouldReviewWithSecondModel([{ label: "advertisement", score: 0.84 }]), true);
  assert.equal(shouldReviewWithSecondModel([{ label: "advertisement", score: 0.85 }]), false);
  assert.equal(shouldReviewWithSecondModel([{ label: "regular website photo", score: 0.99 }]), false);
});

test("second model can promote an ambiguous first-model result only with strong ad evidence", () => {
  const primary = [
    { label: "promotional ad banner", score: 0.62 },
    { label: "regular website photo", score: 0.38 },
  ];
  const strongSecondary = [
    { label: "advertisement", score: 0.91 },
    { label: "news article", score: 0.09 },
  ];
  const weakSecondary = [
    { label: "advertisement", score: 0.70 },
    { label: "news article", score: 0.30 },
  ];

  assert.equal(chooseEnsembleResults(primary, strongSecondary), strongSecondary);
  assert.equal(chooseEnsembleResults(primary, weakSecondary), primary);
  assert.equal(chooseEnsembleResults(primary, []), primary);
});
