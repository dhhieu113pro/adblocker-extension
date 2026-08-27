import { hasExplicitAdOverlayMarker } from "./image-ad-policy.mjs";

export function shouldRemoveTransparentAdOverlay({
  id = "",
  className = "",
  position = "",
  zIndex = Number.NaN,
  width = 0,
  height = 0,
  viewWidth = 0,
  viewHeight = 0,
  backgroundColor = "",
  opacity = 1,
  pointerEvents = "",
  textLength = 0,
  interactiveDescendantCount = 0,
} = {}) {
  if (!hasExplicitAdOverlayMarker(id, className)) return false;
  if (position !== "fixed" && position !== "absolute") return false;

  const numericZIndex = Number(zIndex);
  if (!Number.isFinite(numericZIndex) || numericZIndex < 999) return false;
  if (width < viewWidth * 0.85 || height < viewHeight * 0.85) return false;

  const normalizedBackground = String(backgroundColor).toLowerCase();
  const isBackgroundTransparent = normalizedBackground === "transparent" ||
    normalizedBackground.includes("rgba(0, 0, 0, 0)") ||
    normalizedBackground.includes("rgba(255, 255, 255, 0)") ||
    normalizedBackground === "initial" ||
    normalizedBackground === "";

  if (!(isBackgroundTransparent || Number(opacity) < 0.1) || pointerEvents === "none") return false;
  if (Number(textLength) > 30) return false;
  if (Number(interactiveDescendantCount) > 2) return false;

  return true;
}
