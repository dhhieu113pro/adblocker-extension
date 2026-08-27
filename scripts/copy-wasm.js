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

// 2. Copy offscreen HTML
if (fs.existsSync(distDir)) {
  const htmlFiles = fs.readdirSync(distDir).filter(f => f.endsWith(".html") && !f.startsWith("popup"));

  if (htmlFiles.length > 0) {
    const sorted = htmlFiles
      .map(f => ({ name: f, mtime: fs.statSync(path.join(distDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    const offscreenHashed = sorted[0].name;
    fs.copyFileSync(path.join(distDir, offscreenHashed), path.join(distDir, "offscreen.html"));
    console.log(`✓ offscreen.html copied from ${offscreenHashed}`);
  }
}

// 3. Package ONNX Runtime WASM inside the extension.
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
