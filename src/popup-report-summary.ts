import { buildReportViewModel } from "./report-view-model.mjs";
import { buildProtectionMix } from "./popup-report-summary.mjs";

const chart = document.getElementById("protection-mix-chart") as HTMLElement | null;
const total = document.getElementById("protection-mix-total") as HTMLElement | null;
const ads = document.getElementById("protection-mix-ads") as HTMLElement | null;
const trackers = document.getElementById("protection-mix-trackers") as HTMLElement | null;
const popups = document.getElementById("protection-mix-popups") as HTMLElement | null;

function renderProtectionMix(kpis: Record<string, number> = {}) {
  if (!chart || !total || !ads || !trackers || !popups) return;

  const mix = buildProtectionMix(kpis);
  chart.style.setProperty("--mix-ads-end", `${mix.adsEnd}%`);
  chart.style.setProperty("--mix-trackers-end", `${mix.trackersEnd}%`);
  chart.classList.toggle("is-empty", mix.total === 0);
  chart.setAttribute(
    "aria-label",
    mix.total === 0
      ? "No blocked activity recorded yet"
      : `${mix.total} blocked items: ${mix.ads} ads, ${mix.trackers} trackers, ${mix.popups} popups`,
  );

  total.textContent = String(mix.total);
  ads.textContent = String(mix.ads);
  trackers.textContent = String(mix.trackers);
  popups.textContent = String(mix.popups);
}

async function loadProtectionMix() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "getReportData", range: "all" });
    if (!response?.success) throw new Error(response?.error || "Unable to load report data");
    const vm = buildReportViewModel(response.data || { events: [], daily: {} });
    renderProtectionMix(vm.kpis);
  } catch {
    renderProtectionMix();
  }
}

renderProtectionMix();
loadProtectionMix();
