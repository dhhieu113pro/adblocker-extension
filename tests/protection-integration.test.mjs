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
  assert.match(inject, /chrome\.storage\.sync\.get\(\["autoHideAds", "disabledSites"\]\)/);
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
