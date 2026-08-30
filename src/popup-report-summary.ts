import { buildReportViewModel } from "./report-view-model.mjs";
import {
  buildProtectionMix,
  DEFAULT_PROTECTION_MIX_RANGE,
} from "./popup-report-summary.mjs";

const chart = document.getElementById("protection-mix-chart") as HTMLElement | null;
const total = document.getElementById("protection-mix-total") as HTMLElement | null;
const ads = document.getElementById("protection-mix-ads") as HTMLElement | null;
const trackers = document.getElementById("protection-mix-trackers") as HTMLElement | null;
const popups = document.getElementById("protection-mix-popups") as HTMLElement | null;
const rangeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-mix-range]"));

let activeRange = DEFAULT_PROTECTION_MIX_RANGE;
let requestId = 0;

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

function syncRangeButtons() {
  for (const button of rangeButtons) {
    const selected = button.dataset.mixRange === activeRange;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
}

async function loadProtectionMix(range = activeRange) {
  activeRange = range;
  syncRangeButtons();
  const currentRequestId = ++requestId;

  try {
    const response = await chrome.runtime.sendMessage({ type: "getReportData", range });
    if (!response?.success) throw new Error(response?.error || "Unable to load report data");
    if (currentRequestId !== requestId) return;
    const vm = buildReportViewModel(response.data || { events: [], daily: {} });
    renderProtectionMix(vm.kpis);
  } catch {
    if (currentRequestId === requestId) renderProtectionMix();
  }
}

rangeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    loadProtectionMix(button.dataset.mixRange || DEFAULT_PROTECTION_MIX_RANGE);
  });
});

renderProtectionMix();
syncRangeButtons();
loadProtectionMix();
