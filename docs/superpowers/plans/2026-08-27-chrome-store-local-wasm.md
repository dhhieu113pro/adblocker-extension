# Chrome Store Local WASM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package ONNX Runtime WASM locally, remove redundant Chrome permissions, and add regression checks so Chrome Web Store submissions no longer depend on remote executable WASM.

**Architecture:** Keep remote AI model weights and JSON rules as data, but route Transformers.js ONNX execution to extension-packaged WASM via `chrome.runtime.getURL("wasm/")`. Extend the existing post-build script so every build copies the four ONNX Runtime 1.14.0 WASM fallback binaries into `dist/wasm/`, and lock the contract with Node tests plus the MV3 WASM CSP.

**Tech Stack:** Manifest V3, TypeScript, Node.js 22 test runner, Parcel, Transformers.js 2.17.2, onnxruntime-web 1.14.0, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-27-chrome-store-local-wasm-design.md`

## Global Constraints

- Keep `@xenova/transformers` 2.17.2.
- Keep remote model loading enabled; model weights are data, not executable JS/WASM.
- Keep `<all_urls>` because background/resource inspection needs broad access.
- Do not add remote script/module/WASM sources to the Manifest V3 CSP.
- The packaged WASM contract is exactly the four ONNX Runtime 1.14.0 binaries named in the spec.

---

### Task 1: Add Chrome Store compliance regression tests

**Files:**
- Create: `tests/chrome-store-compliance.test.mjs`
- Read: `src/manifest.json`
- Read: `src/offscreen.ts`
- Read: `scripts/copy-wasm.js`

**Interfaces:**
- Consumes: repository source files and Node built-ins only.
- Produces: regression checks for the manifest permission/CSP contract, local `wasmPaths`, and build-time WASM copy contract.

- [ ] **Step 1: Write the failing tests**

Create tests that assert:

```js
assert.equal(manifest.permissions.includes("activeTab"), false);
assert.equal(manifest.permissions.includes("tabs"), false);
assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
assert.equal(
  manifest.content_security_policy?.extension_pages,
  "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
);
```

and assert the offscreen source contains:

```ts
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("wasm/");
```

and the build script defines/copies these files:

```text
ort-wasm.wasm
ort-wasm-simd.wasm
ort-wasm-threaded.wasm
ort-wasm-simd-threaded.wasm
```

- [ ] **Step 2: Run the tests to verify RED**

Run:

```bash
npm test
```

Expected: the new compliance tests fail because `activeTab`/`tabs` and the duplicate GitHub host are still present, the CSP/local WASM path is absent, and the build script does not copy ONNX WASM.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/chrome-store-compliance.test.mjs
git commit -m "test: lock Chrome Store WASM compliance"
```

### Task 2: Package ONNX Runtime WASM locally

**Files:**
- Modify: `scripts/copy-wasm.js`
- Modify: `src/offscreen.ts`
- Test: `tests/chrome-store-compliance.test.mjs`

**Interfaces:**
- Consumes: `node_modules/onnxruntime-web/dist` and the extension runtime URL API.
- Produces: `dist/wasm/{ort-wasm.wasm,ort-wasm-simd.wasm,ort-wasm-threaded.wasm,ort-wasm-simd-threaded.wasm}` and a local ONNX WASM URL prefix.

- [ ] **Step 1: Extend the post-build copy script**

Define the four required file names, create `dist/wasm`, fail fast when an expected dependency file is missing, and copy each file from `node_modules/onnxruntime-web/dist`.

- [ ] **Step 2: Point Transformers.js to packaged WASM**

Immediately after the existing Transformers.js environment setup in `src/offscreen.ts`, set:

```ts
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("wasm/");
```

- [ ] **Step 3: Run the focused tests**

Run:

```bash
node --test tests/chrome-store-compliance.test.mjs
```

Expected: WASM-path and copy-contract assertions pass; manifest assertions remain red until Task 3.

- [ ] **Step 4: Commit**

```bash
git add scripts/copy-wasm.js src/offscreen.ts
git commit -m "fix: package ONNX runtime WASM locally"
```

### Task 3: Minimize manifest permissions and enable packaged WASM

**Files:**
- Modify: `src/manifest.json`
- Test: `tests/chrome-store-compliance.test.mjs`

**Interfaces:**
- Consumes: Manifest V3 permission/CSP schema.
- Produces: a store-ready manifest with only required permissions and an extension-page CSP that allows packaged WebAssembly.

- [ ] **Step 1: Remove redundant permissions**

Remove `activeTab` and `tabs` from `permissions`, and remove `https://raw.githubusercontent.com/*` from `host_permissions` while retaining `<all_urls>`.

- [ ] **Step 2: Add the MV3 WASM CSP**

Add:

```json
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"
}
```

- [ ] **Step 3: Run all unit tests**

Run:

```bash
npm test
npm run test:coverage
```

Expected: all tests pass and the existing 100% coverage gate remains green.

- [ ] **Step 4: Commit**

```bash
git add src/manifest.json
git commit -m "fix: minimize Chrome Store permissions"
```

### Task 4: Verify built artifact and PR

**Files:**
- Verify: `dist/manifest.json`
- Verify: `dist/wasm/*.wasm`
- Verify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the normal `npm run build` and existing CI/E2E pipeline.
- Produces: a merge-ready PR whose built package contains local executable WASM only.

- [ ] **Step 1: Build**

Run:

```bash
npm run build
```

Expected: build succeeds and the four files exist under `dist/wasm/`.

- [ ] **Step 2: Inspect the built manifest**

Verify it contains no `activeTab` or `tabs`, has only `<all_urls>` under `host_permissions`, and includes the `wasm-unsafe-eval` extension-page CSP.

- [ ] **Step 3: Run installed-extension E2E tests**

Run:

```bash
npm run test:e2e
```

Expected: all existing extension tests pass with locally packaged WASM.

- [ ] **Step 4: Open the pull request and wait for required CI**

PR title:

```text
fix: package ONNX WASM for Chrome Store
```

PR summary must call out local WASM packaging, MV3 CSP, redundant permission removal, and the fact that remote models/JSON remain data only.
