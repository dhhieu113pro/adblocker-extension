# Chrome Store Local WASM Compliance Design

## Goal

Make the Chromium extension compliant with Chrome Web Store Manifest V3 remote-hosted-code requirements by ensuring executable ONNX Runtime WebAssembly is packaged inside the extension, while keeping remote AI model weights and JSON ad rules as data.

## Requirements

- Keep `@xenova/transformers` 2.17.2 and its remote model loading behavior.
- Override Transformers.js/ONNX Runtime `wasmPaths` to a `chrome-extension://` URL under `wasm/`.
- Package the ONNX Runtime 1.14.0 fallback WASM binaries from `node_modules/onnxruntime-web/dist` into `dist/wasm/` on every build:
  - `ort-wasm.wasm`
  - `ort-wasm-simd.wasm`
  - `ort-wasm-threaded.wasm`
  - `ort-wasm-simd-threaded.wasm`
- Add the Manifest V3 extension-page CSP needed for packaged WebAssembly: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`.
- Remove redundant `activeTab` and `tabs` permissions because `<all_urls>` already grants access to matching tab URL properties and the Tabs API methods used by the extension do not otherwise require the `tabs` permission.
- Remove the redundant `https://raw.githubusercontent.com/*` host permission because `<all_urls>` already covers it.
- Retain the required permissions: `scripting`, `offscreen`, `storage`, `contextMenus`, `webNavigation`, and `declarativeNetRequest`.
- Retain `<all_urls>` because the background/content-script ad blocker needs broad page/resource access.
- Add automated regression coverage so a future build cannot silently return to CDN-hosted WASM or reintroduce redundant permissions.

## Verification

- Unit tests fail against the current manifest/build configuration before the fix.
- Unit tests pass after the fix.
- `npm run build` succeeds and produces all four WASM binaries in `dist/wasm/`.
- Existing unit and installed-extension E2E tests remain green.
- Release packaging continues to zip the `dist/` directory, therefore including `dist/wasm/` automatically.
