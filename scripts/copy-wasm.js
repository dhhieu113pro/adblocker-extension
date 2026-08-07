const fs = require("fs");
const path = require("path");

// 1. Clean dist/manifest.json
const manifestPath = path.join(__dirname, "../dist/manifest.json");
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  delete manifest.offscreen_document;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log("✓ dist/manifest.json cleaned");
}

// 2. Copy offscreen HTML
const distDir = path.join(__dirname, "../dist");
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
