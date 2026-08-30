import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const popupHtml = await readFile(new URL("../src/popup.html", import.meta.url), "utf8");
const popupMainTs = await readFile(new URL("../src/popup.ts", import.meta.url), "utf8");
const popupThemeTs = await readFile(new URL("../src/popup-theme.ts", import.meta.url), "utf8").catch(() => "");
const popupTs = `${popupMainTs}\n${popupThemeTs}`;
const popupMainCss = await readFile(new URL("../src/popup.css", import.meta.url), "utf8");
const popupThemeCss = await readFile(new URL("../src/popup-theme.css", import.meta.url), "utf8").catch(() => "");
const popupCss = `${popupMainCss}\n${popupThemeCss}`;

test("popup settings expose System, Light, and Dark theme modes", () => {
  assert.match(popupHtml, /id=["']theme-mode-select["']/);
  assert.match(popupHtml, /value=["']system["']/);
  assert.match(popupHtml, /value=["']light["']/);
  assert.match(popupHtml, /value=["']dark["']/);
});

test("popup defaults to system theme and persists explicit theme overrides", () => {
  assert.match(popupTs, /themeMode/);
  assert.match(popupTs, /res\.themeMode\s*\|\|\s*["']system["']/);
  assert.match(popupTs, /chrome\.storage\.sync\.set\(\{\s*themeMode:/);
  assert.match(popupTs, /matchMedia\(["']\(prefers-color-scheme:\s*dark\)["']\)/);
  assert.match(popupTs, /addEventListener\(["']change["']/);
});

test("popup stylesheet has explicit light and dark palettes", () => {
  assert.match(popupCss, /html\[data-theme=["']light["']\]/);
  assert.match(popupCss, /html\[data-theme=["']dark["']\]/);
  assert.match(popupCss, /@media\s*\(prefers-color-scheme:\s*light\)/);
});
