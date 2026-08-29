import { buildReportViewModel, filterRecentActivity, blockedDomainUrl } from "./report-view-model.mjs";

type ReportEvent = {
  timestamp: number;
  pageDomain: string;
  pageCategory: string;
  sourceDomain: string;
  blockType: string;
  detectionMethod: string;
  resourceType: string;
  blockedTargetDomain?: string;
};

type ReportData = { events: ReportEvent[]; daily: Record<string, any> };

const state: { range: string; data: ReportData; recentQuery: string } = {
  range: "30d",
  data: { events: [], daily: {} },
  recentQuery: "",
};

const statusEl = document.getElementById("status") as HTMLElement;
const recentBody = document.getElementById("recent") as HTMLTableSectionElement;
const searchInput = document.getElementById("recent-search") as HTMLInputElement;
const rangeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-range]"));

function setStatus(message = "", isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(Number(value) || 0);
}

function formatWhen(timestamp: number) {
  if (!timestamp) return "—";
  const diff = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function createEmpty(message: string) {
  const element = document.createElement("div");
  element.className = "empty";
  element.textContent = message;
  return element;
}

function renderRankList(containerId: string, items: Array<{ name: string; count: number }>) {
  const container = document.getElementById(containerId) as HTMLElement;
  container.replaceChildren();
  if (!items.length) {
    container.appendChild(createEmpty("No activity in this range."));
    return;
  }

  const max = Math.max(...items.map((item) => item.count), 1);
  for (const item of items.slice(0, 10)) {
    const row = document.createElement("div");
    row.className = "rank-row";

    const name = document.createElement("span");
    name.className = "rank-name";
    name.textContent = item.name;
    name.title = item.name;

    const track = document.createElement("span");
    track.className = "bar-track";
    const bar = document.createElement("span");
    bar.className = "bar";
    bar.style.width = `${Math.max(2, (item.count / max) * 100)}%`;
    track.appendChild(bar);

    const count = document.createElement("strong");
    count.className = "rank-count";
    count.textContent = formatNumber(item.count);

    row.append(name, track, count);
    container.appendChild(row);
  }
}

function renderTrend(items: Array<any>) {
  const container = document.getElementById("trend") as HTMLElement;
  container.replaceChildren();
  if (!items.length) {
    container.appendChild(createEmpty("No blocking activity yet."));
    return;
  }

  const max = Math.max(...items.map((item) => item.total), 1);
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "trend-row";

    const day = document.createElement("strong");
    day.textContent = item.day;

    const middle = document.createElement("div");
    const track = document.createElement("div");
    track.className = "bar-track";
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.width = `${Math.max(2, (item.total / max) * 100)}%`;
    track.appendChild(bar);

    const meta = document.createElement("div");
    meta.className = "trend-meta";
    meta.textContent = `${item.ads} ads · ${item.trackers} trackers · ${item.popups} popups · ${item.ai} AI`;
    middle.append(track, meta);

    const total = document.createElement("strong");
    total.textContent = formatNumber(item.total);
    row.append(day, middle, total);
    container.appendChild(row);
  }
}

function renderRecent(events: ReportEvent[]) {
  recentBody.replaceChildren();
  const filtered = filterRecentActivity(events, state.recentQuery);
  if (!filtered.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.appendChild(createEmpty(state.recentQuery ? "No matching activity." : "No detailed activity in the last 30 days."));
    row.appendChild(cell);
    recentBody.appendChild(row);
    return;
  }

  for (const event of filtered.slice(0, 100)) {
    const row = document.createElement("tr");
    const values = [
      formatWhen(event.timestamp),
      event.pageDomain || "—",
      event.pageCategory || "Other",
      event.sourceDomain || "—",
    ];
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    }

    const typeCell = document.createElement("td");
    const type = document.createElement("span");
    type.className = "type-chip";
    type.textContent = event.blockType || "ad";
    typeCell.appendChild(type);
    row.appendChild(typeCell);

    const methodCell = document.createElement("td");
    methodCell.textContent = event.detectionMethod || "heuristic";
    row.appendChild(methodCell);

    const actionCell = document.createElement("td");
    const destination = blockedDomainUrl(event.blockedTargetDomain || "");
    if (destination) {
      const open = document.createElement("button");
      open.type = "button";
      open.className = "link-button";
      open.textContent = "Open blocked link";
      open.dataset.openDomain = event.blockedTargetDomain || "";
      actionCell.appendChild(open);
    } else {
      actionCell.textContent = "—";
    }
    row.appendChild(actionCell);
    recentBody.appendChild(row);
  }
}

function render() {
  const vm = buildReportViewModel(state.data);
  (document.getElementById("kpi-ads") as HTMLElement).textContent = formatNumber(vm.kpis.adsBlocked);
  (document.getElementById("kpi-trackers") as HTMLElement).textContent = formatNumber(vm.kpis.trackersBlocked);
  (document.getElementById("kpi-popups") as HTMLElement).textContent = formatNumber(vm.kpis.popupsBlocked);
  (document.getElementById("kpi-sites") as HTMLElement).textContent = formatNumber(vm.kpis.websitesProtected);
  (document.getElementById("kpi-ai") as HTMLElement).textContent = formatNumber(vm.kpis.aiDetected);
  renderTrend(vm.trend);
  renderRankList("websites", vm.websites);
  renderRankList("categories", vm.categories);
  renderRankList("sources", vm.sources);
  renderRankList("methods", vm.detectionMethods);
  renderRankList("resources", vm.resourceTypes);
  renderRecent(vm.recent);
}

async function loadReport() {
  setStatus("Loading local statistics…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "getReportData", range: state.range });
    if (!response?.success) throw new Error(response?.error || "Unable to load report data");
    state.data = response.data || { events: [], daily: {} };
    render();
    setStatus("Report statistics are stored locally on this device.");
  } catch (error) {
    state.data = { events: [], daily: {} };
    render();
    setStatus(String(error), true);
  }
}

async function exportReport(format: "csv" | "json") {
  try {
    const response = await chrome.runtime.sendMessage({ type: "exportReportData", format, range: state.range });
    if (!response?.success) throw new Error(response?.error || "Export failed");
    const mime = format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8";
    const blob = new Blob([response.content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `adblocker-report-${state.range}.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${format.toUpperCase()} locally.`);
  } catch (error) {
    setStatus(String(error), true);
  }
}

rangeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.range = button.dataset.range || "30d";
    rangeButtons.forEach((candidate) => candidate.classList.toggle("active", candidate === button));
    loadReport();
  });
});

searchInput.addEventListener("input", () => {
  state.recentQuery = searchInput.value;
  renderRecent(buildReportViewModel(state.data).recent);
});

document.getElementById("export-csv")?.addEventListener("click", () => exportReport("csv"));
document.getElementById("export-json")?.addEventListener("click", () => exportReport("json"));
document.getElementById("clear-report")?.addEventListener("click", async () => {
  if (!confirm("Clear all locally stored Report statistics? Protection settings and rules will not change.")) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: "clearReportData" });
    if (!response?.success) throw new Error(response?.error || "Clear failed");
    await loadReport();
    setStatus("Local Report statistics cleared.");
  } catch (error) {
    setStatus(String(error), true);
  }
});

recentBody.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-open-domain]");
  if (!button) return;
  const url = blockedDomainUrl(button.dataset.openDomain || "");
  if (url) chrome.tabs.create({ url });
});

loadReport();
