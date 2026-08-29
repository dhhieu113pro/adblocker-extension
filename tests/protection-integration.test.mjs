import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing section start: ${start}`);
  const endIndex = end ? source.indexOf(end, startIndex + start.length) : source.length;
  assert.notEqual(endIndex, -1, `Missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('background automatic navigation and AI paths use the shared protection policy', () => {
  const background = read('src/background.ts');

  assert.match(background, /import \{[^}]*isAutomaticProtectionEnabled[^}]*\} from "\.\/protection-state\.mjs";/s);
  assert.match(background, /async function isProtectionEnabledForUrl\(url: string\)/);
  assert.match(background, /isAutomaticProtectionEnabled\(settings, url\)/);

  const popupTarget = section(background, 'chrome.webNavigation.onCreatedNavigationTarget', '// 2. Prevent same-tab redirects');
  assert.match(popupTarget, /await isProtectionEnabledForUrl\(sourceUrl\)/);

  const sameTab = section(background, 'chrome.webNavigation.onBeforeNavigate', '// 3. AI Visually Classify Website Category');
  assert.match(sameTab, /await isProtectionEnabledForUrl\(sourceUrl\)/);

  const pageAutomation = section(background, 'chrome.webNavigation.onCompleted');
  assert.match(pageAutomation, /await isProtectionEnabledForUrl\(url\)/);

  const detectAd = section(background, 'if (message.type === "detectAd")', 'return false;');
  assert.match(detectAd, /await isProtectionEnabledForUrl\(sender\.tab\?\.url \|\| ""\)/);
});

test('MAIN-world popup and click interception combines global and per-site state', () => {
  const inject = read('src/inject.ts');

  assert.match(inject, /import \{ isAutomaticProtectionEnabled \} from "\.\/protection-state\.mjs";/);
  assert.match(inject, /let siteBlockingEnabled = false;/);
  assert.match(inject, /chrome\.storage\.sync\.get\(\["autoHideAds", "disabledSites"\],/);
  assert.match(inject, /isAutomaticProtectionEnabled\(settings, window\.location\.href\)/);
  assert.match(inject, /changes\.autoHideAds \|\| changes\.disabledSites/);

  const redirectPolicy = section(inject, '  const shouldBlockRedirect', '  // Hook window.open');
  assert.match(redirectPolicy, /if \(!fullProtectionEnabled \|\| !siteBlockingEnabled\) return false;/);

  const clickHandler = section(inject, '  window.addEventListener("click"', '  }, true);');
  assert.match(clickHandler, /if \(!fullProtectionEnabled \|\| !siteBlockingEnabled\) return;/);
});

test('per-site bypass also stops iframe scanning in the content layer', () => {
  const content = read('src/content.js');
  const iframeScan = section(content, '  scanIframes() {', '  scanVideos() {');

  assert.match(iframeScan, /if \(!this\.autoHideAds \|\| this\.siteDisabled\) return;/);
});

test('disabling protection invalidates in-flight automatic ad checks', () => {
  const content = read('src/content.js');
  const constructor = section(content, '  constructor() {', '  async init() {');
  const disable = section(content, '  disableSiteBlocking() {', '  scheduleScan() {');
  const check = section(content, '  async processAdCheck({ img, msg }) {', '  getAdTargetContainer(img) {');

  assert.match(constructor, /this\.protectionGeneration = 0;/);
  assert.match(disable, /this\.protectionGeneration \+= 1;/);
  assert.match(check, /const generation = this\.protectionGeneration;/);
  assert.match(check, /generation (?:===|!==) this\.protectionGeneration/);
  assert.match(check, /this\.autoHideAds/);
  assert.match(check, /this\.siteDisabled/);
});

test('disabling protection restores JW Player audio immediately', () => {
  const content = read('src/content.js');
  const disable = section(content, '  disableSiteBlocking() {', '  scheduleScan() {');
  const restore = section(content, '  restoreJwMutedVideos() {', '  setupJwAdSkipAutomation() {');

  assert.match(disable, /this\.restoreJwMutedVideos\(\);/);
  assert.match(restore, /this\.jwMutedVideos\.forEach\(\(state, video\) =>/);
  assert.match(restore, /video\.muted = state\.muted;/);
  assert.match(restore, /video\.volume = state\.volume;/);
  assert.match(restore, /this\.jwMutedVideos\.clear\(\);/);
});

test('long-running page classification revalidates tab URL and bypass state before acting', () => {
  const background = read('src/background.ts');
  assert.match(background, /async function isTabStillProtected\(tabId: number, expectedUrl: string\)/);

  const helper = section(background, 'async function isTabStillProtected', '// --- Per-image CLIP result cache');
  assert.match(helper, /await chrome\.tabs\.get\(tabId\)/);
  assert.match(helper, /currentTab\.url !== expectedUrl/);
  assert.match(helper, /return isProtectionEnabledForUrl\(currentTab\.url\)/);

  const popupDecision = section(background, 'if (isAdPage && topMatch.score >= 0.50) {', 'return; // Popup tab closed, terminate chain');
  assert.match(popupDecision, /await isTabStillProtected\(tabId, url\)/);
  assert.ok(
    popupDecision.indexOf('await isTabStillProtected(tabId, url)') < popupDecision.indexOf('chrome.tabs.remove(tabId)'),
    'popup protection state must be rechecked before closing the tab',
  );

  const categoryCommit = section(background, '// B. Classify category for general layout', '// Push category directly to inject.ts MAIN world context');
  assert.match(categoryCommit, /await isTabStillProtected\(tabId, url\)/);
  assert.ok(
    categoryCommit.indexOf('await isTabStillProtected(tabId, url)') < categoryCommit.indexOf('tabCategories.set(tabId'),
    'protection state must be rechecked before committing the category',
  );
});
