# Optional Site Access Design

## Goal

Reduce Chrome Web Store review risk from broad required website access while preserving automatic network-level ad blocking by default and preserving the existing AI/DOM protection after one explicit user grant.

## Problem

The current Manifest V3 package declares `host_permissions: ["<all_urls>"]` and two static content scripts whose `matches` are also `<all_urls>`. Chrome treats both required host access and broad static content-script matches as broad website access. Replacing the required host permission with `activeTab` would remove automatic page protection because `activeTab` is temporary and only follows an explicit user gesture.

The extension also uses broad host access for more than page injection: the background service worker downloads remote JSON ad rules, and the AI runtime downloads model data. Any redesign must distinguish executable page access from the small set of network origins the extension itself needs.

## Chosen Approach

Use three protection levels with different permission requirements:

1. **Baseline protection — always available**
   - Keep `declarativeNetRequest` enabled at install time.
   - Install known ad-domain block rules immediately.
   - Keep one narrow required host permission for the remote JSON rules source: `https://raw.githubusercontent.com/*`.
   - Do not inject page scripts and do not run AI/DOM inspection before the user grants website access.

2. **Full protection — explicit one-time user grant**
   - Declare `optional_host_permissions` for `http://*/*` and `https://*/*`.
   - Add an `Enable full protection` action to the popup.
   - Request the optional origins only from that button click so the permission request is tied to an explicit user gesture.
   - After the grant succeeds, dynamically register the existing page-protection scripts for all HTTP/HTTPS pages.
   - The optional permission persists across browser restarts, so full protection remains automatic after the initial grant.

3. **Revoked/denied access — graceful fallback**
   - If the user denies the request, remain in baseline DNR-only mode and do not repeatedly prompt.
   - If the user later revokes website access, unregister the dynamic scripts and immediately disable already-injected page protection through a storage/message state update. Baseline DNR rules remain active.

This preserves the product’s single purpose while moving broad page access from required-at-install to explicit optional access.

## Manifest Changes

`src/manifest.json` will change as follows:

- Remove required `host_permissions: ["<all_urls>"]`.
- Add required `host_permissions: ["https://raw.githubusercontent.com/*"]` so the background service worker can continue loading the remote JSON ad-rule feed before full site access is granted.
- Add:

```json
"optional_host_permissions": [
  "http://*/*",
  "https://*/*"
]
```

- Remove both static `content_scripts` entries so Chrome no longer sees broad static page injection at install time.
- Remove `web_accessible_resources` for `offscreen.html`; the offscreen document is extension-internal and does not need to be exposed to websites.
- Keep `scripting`, `offscreen`, `storage`, `contextMenus`, `webNavigation`, and `declarativeNetRequest` unless implementation evidence shows one is unused.
- Keep the local-WASM CSP:

```text
script-src 'self' 'wasm-unsafe-eval'; object-src 'self';
```

## Runtime Script Packaging

Removing static content scripts from the manifest means Parcel will no longer discover `src/content.js` and `src/inject.ts` as manifest entry points. The build must therefore emit them explicitly.

`package.json` will add a dedicated runtime-script build step:

```text
parcel build src/content.js src/inject.ts --dist-dir dist/runtime --no-source-maps --no-content-hash
```

The main extension build remains manifest-first, then runs the runtime-script build, then copies ONNX WASM files. The expected artifacts are:

```text
dist/runtime/content.js
dist/runtime/inject.js
```

CI will fail if either artifact is missing.

The dynamic registration will reference exactly those stable paths.

## Site Access Controller

Create `src/site-access.ts` as the single source of truth for optional website access.

It will export:

```ts
export const FULL_SITE_ORIGINS = ["http://*/*", "https://*/*"] as const;
export const CONTENT_SCRIPT_ID = "ai-vision-content";
export const MAIN_WORLD_SCRIPT_ID = "ai-vision-main";

export async function hasFullSiteAccess(): Promise<boolean>;
export async function requestFullSiteAccess(): Promise<boolean>;
export async function registerFullProtectionScripts(): Promise<void>;
export async function unregisterFullProtectionScripts(): Promise<void>;
export async function syncFullProtectionRegistration(): Promise<boolean>;
```

`hasFullSiteAccess` uses `chrome.permissions.contains` with `FULL_SITE_ORIGINS`.

`requestFullSiteAccess` uses `chrome.permissions.request` and is only called from the popup button click handler.

`registerFullProtectionScripts` registers two persistent dynamic content scripts:

- `runtime/inject.js`
  - matches `http://*/*` and `https://*/*`
  - `runAt: "document_start"`
  - `allFrames: true`
  - `world: "MAIN"`
  - `persistAcrossSessions: true`

- `runtime/content.js`
  - matches `http://*/*` and `https://*/*`
  - `runAt: "document_idle"`
  - `allFrames: true`
  - `world: "ISOLATED"`
  - `persistAcrossSessions: true`

Registration is idempotent: existing registrations with the same IDs are removed/replaced before registration so extension updates cannot leave stale script definitions.

`unregisterFullProtectionScripts` removes both IDs.

`syncFullProtectionRegistration` checks the current optional permission and registers or unregisters accordingly.

## Background Lifecycle

`src/background.ts` will call `syncFullProtectionRegistration`:

- on service-worker startup;
- inside `runtime.onInstalled`;
- after `permissions.onAdded` when the full-site origins are granted;
- after `permissions.onRemoved` when either full-site origin is removed.

When full access is removed, the service worker also writes a storage flag indicating that DOM protection is disabled and broadcasts a disable message to already-injected content scripts. This prevents already-open pages from continuing DOM/AI protection after permission revocation. Baseline DNR rules are not removed.

The image-analysis context menu is tied to full protection:

- create it when full site access exists;
- remove it when full site access is revoked;
- keep creation idempotent so startup/install events do not create duplicates.

## Immediate Activation After Grant

Dynamic registrations affect future navigations. To avoid making the user reload manually, the popup will send a `fullProtectionGranted` message after a successful permission request.

The background service worker will:

1. synchronize dynamic registrations;
2. identify the active HTTP/HTTPS tab;
3. execute `runtime/inject.js` in `MAIN` world at once;
4. execute `runtime/content.js` in the isolated world at once.

Both runtime scripts will gain idempotency guards so immediate injection cannot initialize duplicate observers/listeners if the page has already received a registered script.

## Popup UX

The current protection strip will represent actual capability instead of assuming full page access.

### Before full access is granted

- Status label: `Basic protection is on`
- Detail: `Known ad networks are blocked. Enable full protection for AI and page-level detection.`
- Show a primary `Enable full protection` button.
- Disable the per-site protection toggle because page-level protection is not yet available.
- `Detected on this page` shows an access-required empty state instead of attempting to message a missing content script.

### After full access is granted

- Hide the grant button.
- Restore the current per-site toggle and detected-ad list behavior.
- Status label returns to `Protection is on` when automatic and per-site settings are enabled.
- Existing `Automatic protection` and vision-model settings continue to control the page-level layer.

### Permission denied

- Keep baseline status visible.
- Do not auto-open another permission prompt.
- The user can click `Enable full protection` again later.

## Data Flow

### Install without optional access

```text
Install
  -> background starts
  -> DNR rules installed
  -> remote JSON rules fetched from raw.githubusercontent.com
  -> no page scripts registered
  -> popup shows Basic protection
```

### User enables full protection

```text
Popup button click
  -> chrome.permissions.request(http/https all sites)
  -> granted
  -> background syncs dynamic registrations
  -> current tab receives immediate injection
  -> future HTTP/HTTPS pages receive persistent registered scripts
  -> popup shows Full protection
```

### User revokes access

```text
permissions.onRemoved
  -> unregister dynamic scripts
  -> mark DOM protection disabled
  -> broadcast disable to already-open injected pages
  -> keep DNR rules active
  -> popup returns to Basic protection
```

## Remote Models and Remote Code

This change does not reintroduce remote executable code.

- ONNX Runtime WASM remains packaged under `dist/wasm/`.
- JavaScript remains packaged inside the extension.
- AI model weights may still be downloaded as model data after full site access is granted.
- Remote ad rules remain JSON configuration data fetched from the narrow GitHub raw-content host.

The Chrome Web Store remote-code answer therefore remains `No`.

## Versioning

This permission model changes install/runtime behavior and requires a new store package. Bump both:

```text
src/manifest.json -> 0.1.14
package.json       -> 0.1.14
```

Update the package-lock root/package version metadata to `0.1.14` as part of the same change so release metadata remains internally consistent.

## Tests

### Static compliance tests

Update `tests/chrome-store-compliance.test.mjs` to assert:

- required host permissions equal only `https://raw.githubusercontent.com/*`;
- optional host permissions equal `http://*/*` and `https://*/*`;
- no static `content_scripts` remain;
- no broad `web_accessible_resources` remain;
- the local-WASM CSP remains unchanged;
- runtime script artifacts are required by the build.

### Site-access unit tests

Add tests around the site-access controller using a small fake Chrome API boundary to prove:

- permission absent -> no dynamic registrations;
- permission granted -> both scripts registered with the correct worlds, matches, run timing, and persistent setting;
- permission revoked -> both scripts unregistered;
- registration is idempotent;
- a denied permission request returns baseline mode without throwing.

### Build tests

The build validation must prove these files exist:

```text
dist/runtime/content.js
dist/runtime/inject.js
dist/wasm/ort-wasm.wasm
dist/wasm/ort-wasm-simd.wasm
dist/wasm/ort-wasm-threaded.wasm
dist/wasm/ort-wasm-simd-threaded.wasm
```

### E2E tests

Playwright installed-extension tests will cover two states:

1. Fresh install without optional host access: popup reports Basic protection and does not expect page-level detected-ad messaging.
2. Granted full-site access: dynamic scripts are registered, the test page receives DOM protection, popup reports full protection, and existing ad detection remains functional.

The existing 100% coverage gate remains mandatory for the production modules currently included in coverage.

## Chrome Web Store Submission Outcome

The new package will no longer require access to every website at install time. The only required host is the explicit GitHub raw-content endpoint used for JSON filter updates. Broad HTTP/HTTPS page access becomes an optional permission requested by the user from the extension UI.

This follows Chrome’s recommended direction for reducing required broad access while preserving the extension’s automatic full-protection mode after explicit consent. It reduces permission-review risk, but does not claim that Chrome will skip manual review; optional broad access may still be reviewed.

## Non-Goals

- Do not convert the extension to `activeTab`-only behavior.
- Do not restrict the blocker to a fixed list of browsing sites.
- Do not remove automatic DNR network blocking.
- Do not move AI inference to a remote service.
- Do not add a separate onboarding page; the existing popup is the permission-entry point.
