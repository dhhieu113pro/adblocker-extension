const OFFLINE_CATEGORIES = new Map([
  ["youtube.com", "Video/Streaming"],
  ["youtu.be", "Video/Streaming"],
  ["netflix.com", "Video/Streaming"],
  ["facebook.com", "Social"],
  ["instagram.com", "Social"],
  ["reddit.com", "Social"],
  ["amazon.com", "Shopping"],
  ["ebay.com", "Shopping"],
  ["google.com", "Search"],
  ["bing.com", "Search"],
  ["github.com", "Technology"],
  ["stackoverflow.com", "Technology"],
]);

const HEURISTIC_SIGNALS = [
  ["Shopping", ["shop", "shopping", "product", "products", "cart", "checkout", "deal", "store"]],
  ["Video/Streaming", ["stream", "streaming", "video", "movie", "movies", "watch", "anime"]],
  ["News", ["news", "article", "articles", "headline", "journal"]],
  ["Social", ["social", "community", "forum", "profile", "follow"]],
  ["Gambling/Betting", [
    "gambling", "betting", "sportsbook", "sports betting", "online casino", "casino",
    "bookmaker", "nhà cái", "nha cai", "cá cược", "ca cuoc", "đặt cược", "dat cuoc",
    "nổ hũ", "no hu", "xổ số", "xo so", "slot game", "slot games",
  ]],
  ["Gaming", ["game", "gaming", "games", "esports"]],
  ["Technology", ["developer", "technology", "tech", "software", "code", "programming"]],
  ["Search", ["search", "results"]],
  ["Productivity", ["productivity", "workspace", "office", "documents", "calendar"]],
  ["Finance", ["finance", "bank", "banking", "stock", "stocks", "invest"]],
  ["Education", ["education", "course", "courses", "learn", "school", "university"]],
  ["Entertainment", ["entertainment", "music", "celebrity", "show", "shows"]],
  ["Adult", ["adult", "porn", "xxx"]],
];

export function normalizeDomain(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || /\s/.test(trimmed)) return "";

  try {
    const parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    const hostname = parsed.hostname.replace(/^www\./, "").replace(/\.$/, "");
    if (!hostname || !hostname.includes(".")) return "";
    return hostname;
  } catch {
    return "";
  }
}

function lookupOfflineCategory(domain) {
  if (!domain) return null;
  for (const [knownDomain, category] of OFFLINE_CATEGORIES) {
    if (domain === knownDomain || domain.endsWith(`.${knownDomain}`)) return category;
  }
  return null;
}

export function classifySite(input = {}) {
  const domain = normalizeDomain(input.domain || input.url || "");
  const offline = lookupOfflineCategory(domain);
  if (offline) return { category: offline, confidence: 95, source: "offline" };

  const haystack = `${domain} ${String(input.metadata || "")}`.toLowerCase();
  let bestCategory = "Other";
  let bestScore = 0;

  for (const [category, keywords] of HEURISTIC_SIGNALS) {
    const score = keywords.reduce((total, keyword) => total + (haystack.includes(keyword) ? 1 : 0), 0);
    if (score > bestScore) {
      bestCategory = category;
      bestScore = score;
    }
  }

  if (bestScore === 0) return { category: "Other", confidence: 0, source: "fallback" };
  return {
    category: bestCategory,
    confidence: Math.min(85, 45 + (bestScore - 1) * 10),
    source: "heuristic",
  };
}
