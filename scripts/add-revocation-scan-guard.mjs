import { readFileSync, writeFileSync } from "node:fs";

const path = "src/content.js";
const source = readFileSync(path, "utf8");
const before = `  scanClickjackingOverlays() {\n    const divs = Array.from(document.querySelectorAll("div, a, iframe, ins"));`;
const after = `  scanClickjackingOverlays() {\n    if (!this.autoHideAds || this.siteDisabled) return;\n    const divs = Array.from(document.querySelectorAll("div, a, iframe, ins"));`;

if (!source.includes(before)) throw new Error("scanClickjackingOverlays patch anchor not found");
writeFileSync(path, source.replace(before, after));
console.log("Added revocation guard to transparent-overlay scanning");
