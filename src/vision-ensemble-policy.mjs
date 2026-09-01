const AD_LABEL_MARKERS = [
  "advertisement",
  "advertising",
  "ad banner",
  "promotional ad",
  "gambling",
  "betting",
];

export const VISION_REVIEW_THRESHOLDS = Object.freeze({
  reviewMin: 0.31,
  reviewMax: 0.84,
  secondaryBlockMin: 0.85,
});

export function findAdScore(results = []) {
  let strongest = 0;
  for (const result of Array.isArray(results) ? results : []) {
    const label = String(result?.label || "").toLowerCase();
    if (!AD_LABEL_MARKERS.some((marker) => label.includes(marker))) continue;
    strongest = Math.max(strongest, Number(result?.score || 0));
  }
  return strongest;
}

export function shouldReviewWithSecondModel(results, thresholds = VISION_REVIEW_THRESHOLDS) {
  const adScore = findAdScore(results);
  return adScore >= thresholds.reviewMin && adScore <= thresholds.reviewMax;
}

export function chooseEnsembleResults(primaryResults, secondaryResults, thresholds = VISION_REVIEW_THRESHOLDS) {
  if (findAdScore(secondaryResults) >= thresholds.secondaryBlockMin) return secondaryResults;
  return primaryResults;
}
