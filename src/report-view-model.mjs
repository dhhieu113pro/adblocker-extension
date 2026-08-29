function increment(target, name, count) {
  if (!name) return;
  target[name] = (Number(target[name]) || 0) + (Number(count) || 0);
}

function ranked(map) {
  return Object.entries(map)
    .map(([name, count]) => ({ name, count: Number(count) || 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function buildReportViewModel(data = {}) {
  const dailyEntries = Object.entries(data.daily || {}).sort(([a], [b]) => a.localeCompare(b));
  const sites = {};
  const categories = {};
  const sources = {};
  const blockTypes = {};
  const detectionMethods = {};
  const resourceTypes = {};
  const trend = [];

  for (const [day, bucket = {}] of dailyEntries) {
    for (const [name, count] of Object.entries(bucket.sites || {})) increment(sites, name, count);
    for (const [name, count] of Object.entries(bucket.categories || {})) increment(categories, name, count);
    for (const [name, count] of Object.entries(bucket.sources || {})) increment(sources, name, count);
    for (const [name, count] of Object.entries(bucket.blockTypes || {})) increment(blockTypes, name, count);
    for (const [name, count] of Object.entries(bucket.detectionMethods || {})) increment(detectionMethods, name, count);
    for (const [name, count] of Object.entries(bucket.resourceTypes || {})) increment(resourceTypes, name, count);
    trend.push({
      day,
      total: Number(bucket.total) || 0,
      ads: Number(bucket.blockTypes?.ad) || 0,
      trackers: Number(bucket.blockTypes?.tracker) || 0,
      popups: Number(bucket.blockTypes?.popup) || 0,
      ai: Number(bucket.detectionMethods?.ai) || 0,
    });
  }

  const recent = [...(Array.isArray(data.events) ? data.events : [])]
    .sort((a, b) => Number(b.timestamp) - Number(a.timestamp));

  return {
    kpis: {
      adsBlocked: Number(blockTypes.ad) || 0,
      trackersBlocked: Number(blockTypes.tracker) || 0,
      popupsBlocked: Number(blockTypes.popup) || 0,
      websitesProtected: Object.keys(sites).length,
      aiDetected: Number(detectionMethods.ai) || 0,
    },
    websites: ranked(sites),
    categories: ranked(categories),
    sources: ranked(sources),
    detectionMethods: ranked(detectionMethods),
    resourceTypes: ranked(resourceTypes),
    trend,
    recent,
  };
}

export function filterRecentActivity(events, query) {
  const needle = String(query || "").trim().toLowerCase();
  if (!needle) return [...events];
  return events.filter((event) => [
    event.pageDomain,
    event.pageCategory,
    event.sourceDomain,
    event.blockType,
    event.detectionMethod,
    event.resourceType,
    event.blockedTargetDomain,
  ].some((value) => String(value || "").toLowerCase().includes(needle)));
}

export function blockedDomainUrl(domain) {
  const value = String(domain || "").trim().toLowerCase();
  if (!value || value.includes("://") || value.includes("/") || value.includes("?") || value.includes("#") || /\s/.test(value)) return "";
  try {
    const parsed = new URL(`https://${value}/`);
    if (parsed.hostname !== value || !value.includes(".")) return "";
    return parsed.href;
  } catch {
    return "";
  }
}
