function normalizeSiteKey(value) {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.hostname.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function normalizeDisabledSites(disabledSites) {
  const sites = Array.isArray(disabledSites) ? disabledSites : [];
  return Array.from(new Set(sites.map(normalizeSiteKey).filter(Boolean)));
}

export function isAutomaticProtectionEnabled(settings = {}, targetUrlOrHost = '') {
  if (settings.autoHideAds === false) return false;
  const site = normalizeSiteKey(targetUrlOrHost);
  if (!site) return false;
  return !normalizeDisabledSites(settings.disabledSites).includes(site);
}

export function getDnrProtectionPolicy(settings = {}) {
  if (settings.autoHideAds === false) {
    return { enabled: false, excludedInitiatorDomains: [] };
  }

  return {
    enabled: true,
    excludedInitiatorDomains: normalizeDisabledSites(settings.disabledSites),
  };
}
