# Optional Site Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace required all-sites access with explicit optional HTTP/HTTPS access while keeping DNR network blocking active by default and restoring automatic AI/DOM protection after one user grant.

**Architecture:** Keep the manifest narrow at install time, package page-protection scripts as stable runtime artifacts, and centralize optional permission + dynamic script registration in `src/site-access.ts`. The popup requests the optional permission from an explicit user gesture; the background synchronizes persistent script registration, revocation, context-menu availability, and immediate injection into the current tab.

**Tech Stack:** Manifest V3, TypeScript, Parcel 2, Chrome Extensions APIs (`permissions`, `scripting`, `storage`, `contextMenus`, `declarativeNetRequest`), Node 22 test runner, Playwright Chromium.

**Spec:** `docs/superpowers/specs/2026-08-27-optional-site-access-design.md`

## Global Constraints

- Keep automatic `declarativeNetRequest` blocking enabled before optional website access is granted.
- Required host access must be limited to `https://raw.githubusercontent.com/*`.
- Optional website access must be exactly `http://*/*` and `https://*/*`.
- Do not use `activeTab` as the primary full-protection model.
- Do not reintroduce static wildcard `content_scripts`.
- Keep executable JavaScript and ONNX Runtime WASM packaged locally; Chrome Web Store remote-code answer remains `No`.
- Keep the existing local-WASM CSP: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`.
- Dynamic content-script IDs are `ai-vision-content` and `ai-vision-main`.
- Dynamic runtime artifacts are `dist/runtime/content.js` and `dist/runtime/inject.js`.
- Full-site permission requests may only originate from an explicit popup button click.
- Version all release metadata as `0.1.14`.
- Preserve the existing 100% production coverage gate and installed-extension E2E suite.

---

### Task 1: Lock the Chrome Store permission contract and runtime build artifacts

**Files:**
- Modify: `tests/chrome-store-compliance.test.mjs`
- Modify: `src/manifest.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `scripts/copy-wasm.js`
- Test: `tests/chrome-store-compliance.test.mjs`

**Interfaces:**
- Consumes: existing manifest-first Parcel build and ONNX WASM post-build step.
- Produces: a manifest with narrow required access, optional HTTP/HTTPS access, no static wildcard page injection, version `0.1.14`, plus stable `dist/runtime/content.js` and `dist/runtime/inject.js` build artifacts.

- [ ] **Step 1: Rewrite the compliance test first so the current branch is RED**

Add assertions equivalent to:

```js
const manifest = readJson("src/manifest.json");

assert.deepEqual(manifest.host_permissions, ["https://raw.githubusercontent.com/*"]);
assert.deepEqual(manifest.optional_host_permissions, ["http://*/*", "https://*/*"]);
assert.equal("content_scripts" in manifest, false);
assert.equal("web_accessible_resources" in manifest, false);
assert.equal(manifest.permissions.includes("activeTab"), false);
assert.equal(manifest.version, "0.1.14");
assert.equal(
  manifest.content_security_policy?.extension_pages,
  "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
);

const packageJson = readJson("package.json");
assert.equal(packageJson.version, "0.1.14");
assert.match(packageJson.scripts["build:runtime"], /parcel build src\/content\.js src\/inject\.ts/);
assert.match(packageJson.scripts.build, /npm run build:runtime/);

const copyScript = readText("scripts/copy-wasm.js");
assert.match(copyScript, /runtime\/content\.js|runtime["'],\s*["']content\.js/);
assert.match(copyScript, /runtime\/inject\.js|runtime["'],\s*["']inject\.js/);
```

Also keep all existing local-WASM and privacy-policy assertions.

- [ ] **Step 2: Run the focused compliance test and confirm it fails for the old broad manifest/build**

Run:

```bash
node --test tests/chrome-store-compliance.test.mjs
```

Expected: FAIL because `host_permissions` is still `<all_urls>`, static `content_scripts` still exist, optional host permissions are absent, version is `0.1.13`, and no runtime build script exists.

- [ ] **Step 3: Apply the minimum manifest and version changes**

Change `src/manifest.json` to this permission shape:

```json
{
  "version": "0.1.14",
  "permissions": [
    "scripting",
    "offscreen",
    "storage",
    "contextMenus",
    "webNavigation",
    "declarativeNetRequest"
  ],
  "host_permissions": [
    "https://raw.githubusercontent.com/*"
  ],
  "optional_host_permissions": [
    "http://*/*",
    "https://*/*"
  ]
}
```

Remove the manifest `content_scripts` and `web_accessible_resources` sections. Preserve the background/action/icons/CSP fields.

Set `package.json` and root/package version entries in `package-lock.json` to `0.1.14`.

- [ ] **Step 4: Add a dedicated runtime-script build with stable names**

Add:

```json
"build:runtime": "parcel build src/content.js src/inject.ts --dist-dir dist/runtime --no-source-maps --no-content-hash",
"build": "parcel build src/manifest.json --config @parcel/config-webextension --no-source-maps && npm run build:runtime && npm run copy-wasm"
```

Do not use hashed filenames because `chrome.scripting.registerContentScripts` will reference these stable paths.

- [ ] **Step 5: Make post-build validation fail if either runtime script is missing**

In `scripts/copy-wasm.js`, after the existing WASM validation, require:

```js
const runtimeFiles = [
  path.join(distDir, "runtime", "content.js"),
  path.join(distDir, "runtime", "inject.js"),
];

for (const file of runtimeFiles) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing packaged runtime script: ${file}`);
  }
}
```

Use the file-system imports/pattern already present in `copy-wasm.js` rather than introducing a second validation script.

- [ ] **Step 6: Run compliance test and build**

Run:

```bash
node --test tests/chrome-store-compliance.test.mjs
npm run build
```

Expected: PASS; build emits both runtime scripts and all four WASM files.

- [ ] **Step 7: Commit the manifest/build contract**

```bash
git add tests/chrome-store-compliance.test.mjs src/manifest.json package.json package-lock.json scripts/copy-wasm.js
git commit -m "build: make broad site access optional"
```

---

### Task 2: Add the optional site-access controller with unit tests

**Files:**
- Create: `src/site-access.ts`
- Create: `tests/site-access.test.mjs`

**Interfaces:**
- Consumes: `chrome.permissions` and `chrome.scripting` APIs.
- Produces:
  - `FULL_SITE_ORIGINS`
  - `CONTENT_SCRIPT_ID`
  - `MAIN_WORLD_SCRIPT_ID`
  - `hasFullSiteAccess(): Promise<boolean>`
  - `requestFullSiteAccess(): Promise<boolean>`
  - `registerFullProtectionScripts(): Promise<void>`
  - `unregisterFullProtectionScripts(): Promise<void>`
  - `syncFullProtectionRegistration(): Promise<boolean>`

- [ ] **Step 1: Write unit tests against a fake Chrome boundary before creating the controller**

Create a fake like:

```js
function createChromeFake({ granted = false, requestResult = granted } = {}) {
  const registrations = new Map();
  return {
    permissions: {
      contains: async ({ origins }) => granted && origins.length === 2,
      request: async () => requestResult,
    },
    scripting: {
      getRegisteredContentScripts: async () => Array.from(registrations.values()),
      unregisterContentScripts: async ({ ids }) => ids.forEach((id) => registrations.delete(id)),
      registerContentScripts: async (items) => items.forEach((item) => registrations.set(item.id, item)),
    },
    _registrations: registrations,
  };
}
```

Set `globalThis.chrome` before dynamically importing `../src/site-access.ts` with a cache-busting query string.

Tests must prove:

```js
assert.equal(await hasFullSiteAccess(), false);
assert.equal(await requestFullSiteAccess(), false);
assert.equal((await syncFullProtectionRegistration()), false);
assert.equal(fake._registrations.size, 0);
```

and for granted access:

```js
assert.equal(await syncFullProtectionRegistration(), true);
assert.deepEqual([...fake._registrations.keys()].sort(), ["ai-vision-content", "ai-vision-main"]);
```

Validate the `MAIN` world/document-start registration and the isolated/document-idle registration, both with `persistAcrossSessions: true`, `allFrames: true`, and HTTP/HTTPS matches.

- [ ] **Step 2: Run the new test and confirm RED**

Run:

```bash
node --test tests/site-access.test.mjs
```

Expected: FAIL because `src/site-access.ts` does not exist.

- [ ] **Step 3: Implement the controller with exact constants and idempotent registration**

Use:

```ts
export const FULL_SITE_ORIGINS = ["http://*/*", "https://*/*"] as const;
export const CONTENT_SCRIPT_ID = "ai-vision-content";
export const MAIN_WORLD_SCRIPT_ID = "ai-vision-main";
const SCRIPT_IDS = [CONTENT_SCRIPT_ID, MAIN_WORLD_SCRIPT_ID];
```

`hasFullSiteAccess`:

```ts
export async function hasFullSiteAccess() {
  return chrome.permissions.contains({ origins: [...FULL_SITE_ORIGINS] });
}
```

`requestFullSiteAccess`:

```ts
export async function requestFullSiteAccess() {
  return chrome.permissions.request({ origins: [...FULL_SITE_ORIGINS] });
}
```

`registerFullProtectionScripts` must first unregister stale registrations with those IDs, then register:

```ts
{
  id: MAIN_WORLD_SCRIPT_ID,
  js: ["runtime/inject.js"],
  matches: [...FULL_SITE_ORIGINS],
  runAt: "document_start",
  allFrames: true,
  world: "MAIN",
  persistAcrossSessions: true,
},
{
  id: CONTENT_SCRIPT_ID,
  js: ["runtime/content.js"],
  matches: [...FULL_SITE_ORIGINS],
  runAt: "document_idle",
  allFrames: true,
  world: "ISOLATED",
  persistAcrossSessions: true,
}
```

`unregisterFullProtectionScripts` must tolerate the IDs not being registered. `syncFullProtectionRegistration` checks the permission, registers when present, unregisters when absent, and returns the resulting boolean state.

- [ ] **Step 4: Run unit tests twice to prove registration is idempotent**

Run:

```bash
node --test tests/site-access.test.mjs
node --test tests/site-access.test.mjs
```

Expected: PASS both times; no duplicate-registration failure.

- [ ] **Step 5: Commit the controller**

```bash
git add src/site-access.ts tests/site-access.test.mjs
git commit -m "feat: add optional site access controller"
```

---

### Task 3: Synchronize full protection from the background and make page scripts safe for immediate injection

**Files:**
- Modify: `src/background.ts`
- Modify: `src/content.js`
- Modify: `src/inject.ts`
- Modify: `tests/chrome-store-compliance.test.mjs`
- Test: `tests/site-access.test.mjs`
- Test: `tests/e2e/extension.spec.mjs`

**Interfaces:**
- Consumes: all exports from `src/site-access.ts`.
- Produces: lifecycle synchronization, permission-revocation shutdown, context-menu synchronization, and immediate activation of runtime scripts in the current tab.

- [ ] **Step 1: Add failing static/lifecycle assertions before editing production code**

In the compliance/static test, assert `background.ts` contains imports/usages for:

```text
syncFullProtectionRegistration
chrome.permissions.onAdded
chrome.permissions.onRemoved
chrome.scripting.executeScript
runtime/inject.js
runtime/content.js
```

Assert both runtime page scripts contain unique initialization sentinels, e.g.:

```text
__aiVisionAdBlockerContentInitialized
__aiVisionAdBlockerMainInitialized
```

Run:

```bash
node --test tests/chrome-store-compliance.test.mjs
```

Expected: FAIL before implementation.

- [ ] **Step 2: Add idempotency guards to both page scripts**

At the top-level entry of `src/content.js`, prevent a second `AdBlockerOverlay` initialization:

```js
if (!globalThis.__aiVisionAdBlockerContentInitialized) {
  globalThis.__aiVisionAdBlockerContentInitialized = true;
  new AdBlockerOverlay();
}
```

Adapt the existing bottom-of-file initialization rather than creating a second instance path.

At the start of the IIFE in `src/inject.ts`, use:

```ts
if ((window as any).__aiVisionAdBlockerMainInitialized) return;
(window as any).__aiVisionAdBlockerMainInitialized = true;
```

- [ ] **Step 3: Import and synchronize site access in the service worker**

Import:

```ts
import {
  FULL_SITE_ORIGINS,
  hasFullSiteAccess,
  syncFullProtectionRegistration,
} from "./site-access";
```

Create a single `syncSiteAccessState()` helper that:

```ts
const enabled = await syncFullProtectionRegistration();
await chrome.storage.local.set({ fullSiteAccessEnabled: enabled });
await syncAnalyzeContextMenu(enabled);
return enabled;
```

Call it on service-worker startup and inside `runtime.onInstalled`.

- [ ] **Step 4: Make the context menu capability-aware and idempotent**

Replace unconditional context-menu creation with:

```ts
async function syncAnalyzeContextMenu(enabled: boolean) {
  await chrome.contextMenus.removeAll();
  if (!enabled) return;
  chrome.contextMenus.create({
    id: "analyze-image-ad",
    title: "✨ Analyze with AI & Detect Ad",
    contexts: ["image"],
  });
}
```

This prevents a menu action that depends on page scripts from appearing in baseline-only mode.

- [ ] **Step 5: Handle permission add/remove events**

Add listeners that only react when the changed origins overlap `FULL_SITE_ORIGINS`:

```ts
chrome.permissions.onAdded.addListener(async (permissions) => {
  if (!permissions.origins?.some((origin) => FULL_SITE_ORIGINS.includes(origin as any))) return;
  await syncSiteAccessState();
});

chrome.permissions.onRemoved.addListener(async (permissions) => {
  if (!permissions.origins?.some((origin) => FULL_SITE_ORIGINS.includes(origin as any))) return;
  const enabled = await syncSiteAccessState();
  if (!enabled) {
    await chrome.storage.local.set({ fullSiteAccessEnabled: false });
    // best-effort broadcast; ignore tabs that no longer have the content script
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map((tab) => tab.id
      ? chrome.tabs.sendMessage(tab.id, { type: "fullProtectionDisabled" }).catch(() => undefined)
      : Promise.resolve()));
  }
});
```

In `content.js`, handle `fullProtectionDisabled` by setting the page layer disabled, clearing detected state, unhiding elements, and stopping new scans; do not remove DNR rules.

- [ ] **Step 6: Add an explicit immediate-activation message for the popup**

Handle a runtime message:

```ts
if (message.type === "activateFullProtectionOnTab") {
  (async () => {
    const enabled = await syncSiteAccessState();
    if (!enabled || !message.tabId) {
      sendResponse({ success: false, enabled });
      return;
    }
    const tab = await chrome.tabs.get(message.tabId);
    if (!/^https?:/.test(tab.url || "")) {
      sendResponse({ success: false, enabled, unsupported: true });
      return;
    }
    await chrome.scripting.executeScript({
      target: { tabId: message.tabId, allFrames: true },
      files: ["runtime/inject.js"],
      world: "MAIN",
    });
    await chrome.scripting.executeScript({
      target: { tabId: message.tabId, allFrames: true },
      files: ["runtime/content.js"],
      world: "ISOLATED",
    });
    sendResponse({ success: true, enabled: true });
  })().catch((error) => sendResponse({ success: false, error: String(error) }));
  return true;
}
```

The popup supplies the active tab ID so the background does not guess which window/tab initiated the grant.

- [ ] **Step 7: Run focused tests and full build**

Run:

```bash
node --test tests/chrome-store-compliance.test.mjs tests/site-access.test.mjs
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit background/runtime synchronization**

```bash
git add src/background.ts src/content.js src/inject.ts tests/chrome-store-compliance.test.mjs
git commit -m "feat: sync full protection with optional access"
```

---

### Task 4: Add the one-time full-protection grant flow to the popup

**Files:**
- Modify: `src/popup.html`
- Modify: `src/popup.ts`
- Modify: `src/popup.css`
- Test: `tests/e2e/extension.spec.mjs`

**Interfaces:**
- Consumes: `hasFullSiteAccess()` and `requestFullSiteAccess()` from `src/site-access.ts`; background message `activateFullProtectionOnTab`.
- Produces: baseline/full-protection UI state and the only user gesture that requests all-site optional access.

- [ ] **Step 1: Add failing E2E expectations for fresh-install baseline mode**

Update the E2E setup so the first popup load asserts:

```js
await expect(popup.locator('#status-label')).toHaveText('Basic protection is on');
await expect(popup.locator('#status-detail')).toContainText('Known ad networks are blocked');
await expect(popup.getByRole('button', { name: 'Enable full protection' })).toBeVisible();
await expect(popup.locator('#site-block-toggle')).toBeDisabled();
await expect(popup.locator('#ad-list')).toContainText('Enable full protection');
```

Run:

```bash
npm run build
npm run test:e2e -- --grep "Basic protection"
```

Expected: FAIL because the current popup assumes full access.

- [ ] **Step 2: Add the permission CTA to the popup markup**

Inside the protection strip/copy area add:

```html
<button id="enable-full-protection-btn" class="primary-button" type="button">
  Enable full protection
</button>
```

Keep it in the existing Overview panel; do not add a new onboarding page.

- [ ] **Step 3: Centralize popup access-state rendering**

Import:

```ts
import { hasFullSiteAccess, requestFullSiteAccess } from "./site-access";
```

Add state:

```ts
let fullSiteAccess = false;
```

Add `refreshSiteAccessState()` that calls `hasFullSiteAccess()`, updates `fullSiteAccess`, then calls `updateProtectionState()`, `loadTabAds()`, and `queryTabCategory()` only when full access exists.

Before access:

```ts
statusLabel.textContent = "Basic protection is on";
statusDetail.textContent = "Known ad networks are blocked. Enable full protection for AI and page-level detection.";
enableFullProtectionBtn.hidden = false;
siteBlockToggle.disabled = true;
renderAccessRequiredState();
```

After access:

```ts
enableFullProtectionBtn.hidden = true;
// then use the existing global/site toggle logic
```

- [ ] **Step 4: Request access only from the CTA click**

Use:

```ts
enableFullProtectionBtn.addEventListener("click", async () => {
  enableFullProtectionBtn.disabled = true;
  try {
    const granted = await requestFullSiteAccess();
    if (!granted) {
      await refreshSiteAccessState();
      return;
    }

    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab?.id) {
      await chrome.runtime.sendMessage({
        type: "activateFullProtectionOnTab",
        tabId: activeTab.id,
      });
    }
    await refreshSiteAccessState();
  } finally {
    enableFullProtectionBtn.disabled = false;
  }
});
```

Do not call `chrome.permissions.request` during popup load or from background startup.

- [ ] **Step 5: Add minimal styling that fits the existing popup**

Add `.primary-button` styling to `popup.css` using existing spacing/radius/font tokens. Do not redesign unrelated tabs or settings.

- [ ] **Step 6: Preserve existing per-site behavior after full access**

Only bind/read `disabledSites`, detected ads, and page category when `fullSiteAccess === true`. Browser-internal pages remain “Protection unavailable”; HTTP/HTTPS pages with access use the current per-site toggle.

- [ ] **Step 7: Run popup/E2E tests**

Run:

```bash
npm run build
npm run test:e2e
```

Expected: baseline-mode tests pass; existing popup navigation/settings/history tests remain green or are updated only where the new capability state legitimately changes the expected copy.

- [ ] **Step 8: Commit popup grant flow**

```bash
git add src/popup.html src/popup.ts src/popup.css tests/e2e/extension.spec.mjs
git commit -m "feat: request full protection from popup"
```

---

### Task 5: Prove granted access restores automatic DOM protection and revocation falls back cleanly

**Files:**
- Modify: `tests/e2e/extension.spec.mjs`
- Modify: `tests/site-access.test.mjs`
- Modify: `tests/chrome-store-compliance.test.mjs`
- Modify: `docs/CHROME_STORE_PUBLISHING.md`

**Interfaces:**
- Consumes: final permission flow, runtime build artifacts, popup CTA, background lifecycle.
- Produces: end-to-end evidence and submission guidance for Chrome Web Store.

- [ ] **Step 1: Add E2E helper to grant optional HTTP/HTTPS origins from the extension context**

Use the extension popup/service-worker context to call:

```js
await popup.evaluate(async () => {
  const granted = await chrome.permissions.request({
    origins: ["http://*/*", "https://*/*"],
  });
  if (!granted) throw new Error("Test could not grant full-site permission");
});
```

If headless Chromium rejects direct automation of the permission prompt, use the extension API from a trusted extension page and assert the returned grant; do not weaken production code to accommodate the test.

- [ ] **Step 2: Add E2E test for full protection after the grant**

After granting permission and reloading/opening the test page:

```js
await expect.poll(async () => page.locator('#adbro').evaluate((el) => ({
  hidden: el.dataset.webllmAdHidden,
  display: getComputedStyle(el).display,
}))).toEqual({ hidden: 'true', display: 'none' });
```

Also assert the popup hides the grant CTA and shows normal full-protection status.

- [ ] **Step 3: Add E2E revocation coverage**

Remove the optional origins from an extension page:

```js
await popup.evaluate(() => chrome.permissions.remove({
  origins: ["http://*/*", "https://*/*"],
}));
```

Then assert:

```js
await expect(popup.locator('#status-label')).toHaveText('Basic protection is on');
await expect(popup.getByRole('button', { name: 'Enable full protection' })).toBeVisible();
```

Open a fresh HTTP page after revocation and confirm no DOM content-script hiding occurs. Do not assert that DNR is disabled; baseline DNR remains enabled by design.

- [ ] **Step 4: Update Chrome Store publishing guidance**

Document the new required/optional permission explanation:

```text
Required host permission: access to raw.githubusercontent.com is used only to download JSON ad-filter rule data.
Optional site access: full HTTP/HTTPS access is requested only when the user chooses Enable full protection, and is used for automatic page-level ad detection/hiding and local AI analysis.
Remote code: No. Executable JavaScript and WASM are packaged with the extension; remote model weights and JSON rules are data.
```

Explicitly note that optional broad access can still receive manual Chrome Web Store review; the change reduces required-at-install breadth rather than guaranteeing review avoidance.

- [ ] **Step 5: Run the complete verification gate**

Run exactly:

```bash
npm ci
npm run test:coverage
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
node scripts/generate-edge-store-screenshots.mjs
```

Expected: every command exits 0; coverage remains 100%; build emits runtime scripts + WASM; E2E covers baseline, granted, and revoked states.

- [ ] **Step 6: Inspect built manifest and artifacts**

Run:

```bash
node -e "const m=require('./dist/manifest.json'); console.log(JSON.stringify({version:m.version, permissions:m.permissions, host_permissions:m.host_permissions, optional_host_permissions:m.optional_host_permissions, content_scripts:m.content_scripts}, null, 2))"
ls -l dist/runtime/content.js dist/runtime/inject.js dist/wasm/*.wasm
```

Expected manifest summary:

```json
{
  "version": "0.1.14",
  "host_permissions": ["https://raw.githubusercontent.com/*"],
  "optional_host_permissions": ["http://*/*", "https://*/*"]
}
```

and `content_scripts` is absent.

- [ ] **Step 7: Commit final E2E/docs verification work**

```bash
git add tests/e2e/extension.spec.mjs tests/site-access.test.mjs tests/chrome-store-compliance.test.mjs docs/CHROME_STORE_PUBLISHING.md
git commit -m "test: verify optional site access lifecycle"
```

- [ ] **Step 8: Open the PR only after the branch is freshly green**

PR title:

```text
feat: make full site access optional
```

PR summary must state:

```text
- keeps DNR baseline blocking active without broad required site access
- moves HTTP/HTTPS page access behind an explicit Enable full protection user gesture
- dynamically registers packaged MAIN/ISOLATED page scripts after grant
- falls back to baseline protection on denial/revocation
- bumps the store package to 0.1.14
- keeps JavaScript/WASM local and remote-code declaration as No
```
