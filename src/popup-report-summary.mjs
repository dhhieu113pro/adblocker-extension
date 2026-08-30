export const DEFAULT_PROTECTION_MIX_RANGE = "7d";
export const PROTECTION_MIX_RANGES = [
  { label: "Weekly", value: "7d" },
  { label: "Monthly", value: "30d" },
  { label: "Yearly", value: "365d" },
  { label: "All", value: "all" },
];

function count(value) {
  const parsed = Number(value) || 0;
  return Math.max(0, parsed);
}

export function buildProtectionMix(kpis = {}) {
  const ads = count(kpis.adsBlocked);
  const trackers = count(kpis.trackersBlocked);
  const popups = count(kpis.popupsBlocked);
  const total = ads + trackers + popups;

  if (total === 0) {
    return { ads, trackers, popups, total, adsEnd: 0, trackersEnd: 0 };
  }

  const adsEnd = (ads / total) * 100;
  const trackersEnd = adsEnd + (trackers / total) * 100;

  return { ads, trackers, popups, total, adsEnd, trackersEnd };
}
