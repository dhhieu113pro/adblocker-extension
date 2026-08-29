from pathlib import Path
import re

path = Path("src/content.js")
source = path.read_text()

# First-stage source-aware scanning (kept idempotent for clean branches).
if "this.processedImageUrls = new WeakMap();" not in source:
    source = re.sub(
        r"^(\s*)this\.processedImages = new WeakSet\(\);$",
        lambda m: f"{m.group(1)}this.processedImages = new WeakSet();\n{m.group(1)}this.processedImageUrls = new WeakMap();",
        source,
        flags=re.M,
    )

    constructor_anchor = "    this.processedImageUrls = new WeakMap();\n    this.detectedAdsMap = new Map();"
    if constructor_anchor not in source:
        raise SystemExit("constructor processed-image anchor not found")
    source = source.replace(
        constructor_anchor,
        "    this.processedImageUrls = new WeakMap();\n    this.currentPageUrl = window.location.href;\n    this.detectedAdsMap = new Map();",
        1,
    )

    observer_anchor = '''  setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      let hasNewNodes = false;
      for (const m of mutations) {
        if (m.type === "childList" && m.addedNodes.length > 0) hasNewNodes = true;
'''
    observer_replacement = '''  handlePageNavigation() {
    const nextUrl = window.location.href;
    if (nextUrl === this.currentPageUrl) return;
    this.currentPageUrl = nextUrl;
    this.protectionGeneration += 1;
    this.detectedAdsMap.clear();
    this.adCheckQueue = [];
    this.adCheckUrls.clear();
    this.processedImages = new WeakSet();
    this.processedImageUrls = new WeakMap();
    if (!this.autoHideAds || this.siteDisabled) return;
    this.scanImages();
    this.scanVideos();
  }

  setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      if (window.location.href !== this.currentPageUrl) this.handlePageNavigation();
      let hasNewNodes = false;
      let hasImageSourceChange = false;
      for (const m of mutations) {
        if (m.type === "childList" && m.addedNodes.length > 0) hasNewNodes = true;
        if (m.type === "attributes" && m.target?.tagName === "IMG" && ["src", "data-src", "data-lazy-src"].includes(m.attributeName)) hasImageSourceChange = true;
'''
    if observer_anchor not in source:
        raise SystemExit("mutation observer anchor not found")
    source = source.replace(observer_anchor, observer_replacement, 1)

    scan_schedule_anchor = '''      if (hasNewNodes) this.scanClickjackingOverlays();
      if (hasNewNodes) this.scanKnownAdSlots();
      this.scheduleScan();
'''
    scan_schedule_replacement = '''      if (hasNewNodes) this.scanClickjackingOverlays();
      if (hasNewNodes) this.scanKnownAdSlots();
      if (hasImageSourceChange) this.scanImages();
      this.scheduleScan();
'''
    if scan_schedule_anchor not in source:
        raise SystemExit("mutation scheduling anchor not found")
    source = source.replace(scan_schedule_anchor, scan_schedule_replacement, 1)

    scan_anchor = '''    Array.from(document.querySelectorAll("img")).forEach((img) => {
      if (this.processedImages.has(img)) return;
      const checkAndProcess = () => {
        if (!this.shouldAnalyzeImage(img)) return;
        this.processedImages.add(img);
        if (!this.autoHideAds) return;
        const imgSrc = img.currentSrc || img.src;
'''
    scan_replacement = '''    Array.from(document.querySelectorAll("img")).forEach((img) => {
      const initialSrc = this.getImageSource(img);
      if (this.processedImageUrls.get(img) === initialSrc) return;
      const checkAndProcess = () => {
        const imgSrc = this.getImageSource(img);
        if (this.processedImageUrls.get(img) === imgSrc) return;
        if (!this.shouldAnalyzeImage(img)) return;
        this.processedImageUrls.set(img, imgSrc);
        if (!this.autoHideAds) return;
'''
    if scan_anchor not in source:
        raise SystemExit("image scan anchor not found")
    source = source.replace(scan_anchor, scan_replacement, 1)

    load_guard_anchor = '''      if (!img.complete && !this.processedImages.has(img)) {
        img.addEventListener("load", checkAndProcess, { once: true });
      }
'''
    load_guard_replacement = '''      if (!img.complete && this.processedImageUrls.get(img) !== this.getImageSource(img)) {
        img.addEventListener("load", checkAndProcess, { once: true });
      }
'''
    if load_guard_anchor not in source:
        raise SystemExit("image load guard anchor not found")
    source = source.replace(load_guard_anchor, load_guard_replacement, 1)

    helper_anchor = "  scanImages() {\n"
    helper = '''  getImageSource(img) {
    return img.currentSrc || img.src || img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || "";
  }

  scanImages() {
'''
    if helper_anchor not in source:
        raise SystemExit("scanImages helper anchor not found")
    source = source.replace(helper_anchor, helper, 1)

# Keep the URL map in sync in the one compact reset site the line-based pass cannot expand.
source = source.replace(
    'else { this.processedImages = new WeakSet(); this.scheduleScan(); }',
    'else { this.processedImages = new WeakSet(); this.processedImageUrls = new WeakMap(); this.scheduleScan(); }',
)

# Directly observe History API navigation. Mutation observation remains a fallback for routers
# that change location and DOM in unusual order.
if "setupNavigationTracking()" not in source:
    init_anchor = '''    this.setupMutationObserver();
    this.initMessageListener();
'''
    if init_anchor not in source:
        raise SystemExit("init navigation anchor not found")
    source = source.replace(
        init_anchor,
        '''    this.setupMutationObserver();
    this.setupNavigationTracking();
    this.initMessageListener();
''',
        1,
    )

    method_anchor = "  setupMutationObserver() {\n"
    navigation_method = '''  setupNavigationTracking() {
    const originalPushState = history.pushState.bind(history);
    history.pushState = (...args) => {
      const result = originalPushState(...args);
      queueMicrotask(() => this.handlePageNavigation());
      return result;
    };
    const originalReplaceState = history.replaceState.bind(history);
    history.replaceState = (...args) => {
      const result = originalReplaceState(...args);
      queueMicrotask(() => this.handlePageNavigation());
      return result;
    };
    window.addEventListener("popstate", () => queueMicrotask(() => this.handlePageNavigation()));
    window.addEventListener("hashchange", () => queueMicrotask(() => this.handlePageNavigation()));
  }

  setupMutationObserver() {
'''
    if method_anchor not in source:
        raise SystemExit("navigation method anchor not found")
    source = source.replace(method_anchor, navigation_method, 1)

# Never apply an async classification to a reused node after its URL has changed.
if source.count("this.getImageSource(img) !== msg.imageUrl") < 2:
    start_anchor = '''  async processAdCheck({ img, msg }) {
    const generation = this.protectionGeneration;
    if (!img?.isConnected) return;

    const preflight = await this.requestAdDecision({ ...msg, preflightOnly: true });
'''
    start_replacement = '''  async processAdCheck({ img, msg }) {
    const generation = this.protectionGeneration;
    if (!img?.isConnected || this.getImageSource(img) !== msg.imageUrl) return;

    const preflight = await this.requestAdDecision({ ...msg, preflightOnly: true });
'''
    if start_anchor not in source:
        raise SystemExit("processAdCheck start anchor not found")
    source = source.replace(start_anchor, start_replacement, 1)

    preflight_guard = '''    if (generation !== this.protectionGeneration || !this.autoHideAds || this.siteDisabled || !img?.isConnected) return;
'''
    preflight_guard_replacement = '''    if (generation !== this.protectionGeneration || !this.autoHideAds || this.siteDisabled || !img?.isConnected || this.getImageSource(img) !== msg.imageUrl) return;
'''
    if preflight_guard not in source:
        raise SystemExit("preflight source guard anchor not found")
    source = source.replace(preflight_guard, preflight_guard_replacement, 1)

    result_guard = '''    if (generation === this.protectionGeneration && this.autoHideAds && !this.siteDisabled && shouldBlockDetectionResult(result) && img?.isConnected) {
'''
    result_guard_replacement = '''    if (generation === this.protectionGeneration && this.autoHideAds && !this.siteDisabled && shouldBlockDetectionResult(result) && img?.isConnected && this.getImageSource(img) === msg.imageUrl) {
'''
    if result_guard not in source:
        raise SystemExit("result source guard anchor not found")
    source = source.replace(result_guard, result_guard_replacement, 1)

path.write_text(source)
