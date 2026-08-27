const fs = require("fs");
const path = require("path");

const distDir = path.join(__dirname, "../dist");

// 1. Clean dist/manifest.json
const manifestPath = path.join(distDir, "manifest.json");
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  delete manifest.offscreen_document;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log("✓ dist/manifest.json cleaned");
}

// 2. Validate the explicitly packaged offscreen AI document.
const offscreenPath = path.join(distDir, "offscreen.html");
if (!fs.existsSync(offscreenPath)) {
  throw new Error(`Missing packaged offscreen document: ${offscreenPath}`);
}
console.log("✓ offscreen.html packaged");

// 3. Validate stable page-protection runtime scripts used by dynamic registration.
const runtimeFiles = [
  path.join(distDir, "runtime", "content.js"),
  path.join(distDir, "runtime", "inject.js"),
];

for (const file of runtimeFiles) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing packaged runtime script: ${file}`);
  }
}
console.log("✓ runtime/content.js and runtime/inject.js packaged");

// 4. Package ONNX Runtime WASM inside the extension.
// Transformers.js defaults these binaries to a CDN. Chrome Web Store MV3
// requires executable WASM to ship in the extension package instead.
const wasmFiles = [
  "ort-wasm.wasm",
  "ort-wasm-simd.wasm",
  "ort-wasm-threaded.wasm",
  "ort-wasm-simd-threaded.wasm",
];
const wasmSourceDir = path.join(__dirname, "..", "node_modules", "onnxruntime-web", "dist");
const wasmTargetDir = path.join(distDir, "wasm");

if (fs.existsSync(distDir)) {
  fs.mkdirSync(wasmTargetDir, { recursive: true });

  for (const file of wasmFiles) {
    const source = path.join(wasmSourceDir, file);
    const target = path.join(wasmTargetDir, file);

    if (!fs.existsSync(source)) {
      throw new Error(`Missing ONNX Runtime WASM dependency: ${source}`);
    }

    fs.copyFileSync(source, target);
    console.log(`✓ wasm/${file} packaged`);
  }
}
