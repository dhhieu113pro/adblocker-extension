// ---------- Known ad / redirect domains ----------
export const AD_DOMAINS = new Set([
  "doubleclick.net", "googlesyndication.com", "googleadservices.com",
  "adsterra.com", "popads.net", "popcash.net", "exoclick.com",
  "juicyads.com", "propellerads.com", "taboola.com", "outbrain.com",
  "i9.top", "colatv.vn", "vsbet.com", "nhacai.com", "rg.pro.vn"
]);

// ---------- Domains to never flag (CDNs, infra, mainstream sites) ----------
export const TRUSTED_DOMAINS = new Set([
  "cloudfront.net", "amazonaws.com", "googleapis.com", "gstatic.com",
  "cloudflare.com", "github.io", "vercel.app", "netlify.app",
  "google.com", "youtube.com", "facebook.com", "wikipedia.org", "github.com"
]);

// ---------- Hard ad-network URL signatures ----------
// Match immediately (no AI round-trip) for any resource served from these
// networks. Shared by content.js (video + image fast-hide) and background.
export const HARD_AD_NETWORKS = new Set([
  "populartooth.com", "adm.centraladtool.com", "adsmicro.com", "adx.admicro.vn"
]);
const HARD_AD_NETWORK_RE = /populartooth|admicro|adnzone|admzone|adxzone|sspp|adsnano/i;

export function isHardAdNetwork(url?: string): boolean {
  if (!url) return false;
  if (HARD_AD_NETWORK_RE.test(url)) return true;
  try {
    return HARD_AD_NETWORKS.has(new URL(url).hostname.replace(/^www\./, ""));
  } catch {
    return false;
  }
}

// ---------- Path / query signatures ----------
// Heuristic-only: applied to streaming/ad-prone sites, never to normal sites.
export const AD_PATH_PATTERNS = [
  /\/ads?\//i, /\/adserver\//i, /\/popunder/i, /\/clickunder/i,
  /\/sponsored\//i, /\/shortlink\//i, /\/redirect\//i, /\/promos?\//i
]; // ponytail: removed /baogia/ rule (false positives); heuristics gated behind aggressive flag

export const AD_QUERY_PARAMS = ["ad_id", "click_id", "aff_id", "prmtracking", "utm_source=ad"];

export const STREAMING_KEYWORDS = [
  "phim", "chill", "hay", "tv", "vtv", "anime", "cliptv", "fptplay",
  "vieon", "mot", "sub", "vietsub", "movie", "movies", "hd", "stream"
];

export const COMIC_KEYWORDS = ["manga", "comic", "truyen", "torrent"];

// Domains that are safe external targets for redirects / popups
const SAFE_EXTERNAL_DOMAINS = [
  "google.com", "facebook.com", "github.com", "twitter.com",
  "apple.com", "microsoft.com", "youtube.com", "vimeo.com",
  "imdb.com", "wikipedia.org", "discord.com", "reddit.com"
];

// ---------- Entropy / randomness helpers ----------
export function calculateEntropy(str: string): number {
  const freq: Record<string, number> = {};
  for (const char of str) freq[char] = (freq[char] || 0) + 1;
  let entropy = 0;
  const len = str.length;
  for (const char in freq) {
    const p = freq[char] / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function isHighEntropy(label: string): boolean {
  if (label.length < 6) return false;
  return calculateEntropy(label) > 3.2;
}

export function looksRandom(label: string): boolean {
  const vowels = (label.match(/[aeiou]/gi) || []).length;
  const digits = (label.match(/[0-9]/g) || []).length;

  if (label.length >= 6 && vowels === 0) return true;           // no vowels at all
  if (/[bcdfghjklmnpqrstvwxyz]{5,}/i.test(label)) return true;  // consonant wall
  if (digits > 0 && label.length <= 10 && digits / label.length > 0.25) return true; // digit-heavy

  return false;
}

export function isTrustedInfra(hostname: string): boolean {
  return [...TRUSTED_DOMAINS].some(d => hostname === d || hostname.endsWith("." + d));
}

export function hasRandomLookingLabel(hostname: string): boolean {
  if (isTrustedInfra(hostname)) return false;
  const labels = hostname.split(".").filter(l => l.length > 0);
  return labels.some(label => {
    if (label.length < 5) return false;
    return isHighEntropy(label) || looksRandom(label);
  });
}

// ---------- Main ad URL matcher ----------
// baseUrl resolves relative URLs (content-script context); omit it for absolute URLs only.
// aggressive=true enables heuristic signals (path/query/entropy) — only for streaming/ad-prone sites
// where a legit page with an "/ads/" path is far less likely.
export function isAdUrl(rawUrl: any, baseUrl?: string, aggressive = false): boolean {
  if (!rawUrl) return false;

  let url: URL;
  try {
    url = baseUrl ? new URL(rawUrl.toString(), baseUrl) : new URL(rawUrl.toString());
  } catch {
    return false; // invalid URL, don't flag
  }

  const hostname = url.hostname.toLowerCase();

  // Never flag trusted infra domains (CDNs, mainstream sites) — even aggressive
  if (isTrustedInfra(hostname)) return false;

  // 1. Known ad domain (exact or subdomain match) — hard signal, all sites
  if ([...AD_DOMAINS].some(d => hostname === d || hostname.endsWith("." + d))) return true;

  // 2. Raw external IP host — hard signal, but keep local development links usable
  if (
    /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) &&
    !["0.0.0.0", "127.0.0.1"].includes(hostname)
  ) return true;

  // Heuristic signals below can false-positive on legit pages (e.g. /ads/ on a news site),
  // so they only apply on streaming/ad-prone sites where aggressive blocking is justified.
  if (!aggressive) return false;

  // 3. Suspicious path — heuristic
  if (AD_PATH_PATTERNS.some(re => re.test(url.pathname.toLowerCase()))) return true;

  // 4. Suspicious query params — heuristic
  if (AD_QUERY_PARAMS.some(p => url.search.toLowerCase().includes(p))) return true;

  // 5. Random-looking domain label (DGA-style generated domains) — heuristic
  if (hasRandomLookingLabel(hostname)) return true;

  return false;
}

// Pure hostname keyword check for streaming/comic ad-prone sites.
export function isStreamingKeywordSite(urlStr: string): boolean {
  try {
    const host = new URL(urlStr).hostname.toLowerCase();
    return [...STREAMING_KEYWORDS, ...COMIC_KEYWORDS].some(kw => host.includes(kw));
  } catch {
    return false;
  }
}

function getCoreDomain(host: string): string {
  const parts = host.toLowerCase().split(".");
  if (parts.length < 2) return host;
  const commonSubTlds = ["com", "co", "net", "org", "gov", "edu"];
  const secondToLast = parts[parts.length - 2];
  if (parts.length >= 3 && commonSubTlds.includes(secondToLast)) {
    return parts[parts.length - 3];
  }
  return secondToLast;
}

export function isExternalAdUrl(targetUrlStr: string, sourceUrlStr: string): boolean {
  if (!targetUrlStr || !sourceUrlStr) return false;
  try {
    const targetUrl = new URL(targetUrlStr);
    const sourceUrl = new URL(sourceUrlStr);

    if (targetUrl.protocol === "chrome-extension:" || targetUrl.protocol === "about:") {
      return false;
    }

    const targetHost = targetUrl.hostname.toLowerCase();
    const sourceHost = sourceUrl.hostname.toLowerCase();

    if (!targetHost || targetHost === sourceHost || targetHost.endsWith("." + sourceHost)) {
      return false;
    }

    // Allow same core brand domain (e.g. phimmoichill.tv on phimmoichill.club)
    if (getCoreDomain(targetHost) === getCoreDomain(sourceHost)) {
      return false;
    }

    if (SAFE_EXTERNAL_DOMAINS.some(domain => targetHost === domain || targetHost.endsWith("." + domain))) {
      return false;
    }

    return true; // Different domain & not whitelisted -> Block!
  } catch (e) {
    return true; // Block on parse errors for maximum safety
  }
}