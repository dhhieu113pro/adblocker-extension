type ThemeMode = "system" | "light" | "dark";

const systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
let themeMode: ThemeMode = "system";

function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "light" || value === "dark" ? value : "system";
}

function applyTheme(mode: ThemeMode) {
  themeMode = mode;
  const resolvedTheme = mode === "system"
    ? (systemThemeQuery.matches ? "dark" : "light")
    : mode;

  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
}

systemThemeQuery.addEventListener("change", () => {
  if (themeMode === "system") applyTheme("system");
});

chrome.storage.sync.get(["themeMode"], (res) => {
  const savedThemeMode = res.themeMode || "system";
  applyTheme(normalizeThemeMode(savedThemeMode));

  const themeModeSelect = document.getElementById("theme-mode-select") as HTMLSelectElement | null;
  if (themeModeSelect) themeModeSelect.value = themeMode;
});

document.addEventListener("DOMContentLoaded", () => {
  const themeModeSelect = document.getElementById("theme-mode-select") as HTMLSelectElement | null;
  if (!themeModeSelect) return;

  themeModeSelect.value = themeMode;
  themeModeSelect.addEventListener("change", () => {
    const nextThemeMode = normalizeThemeMode(themeModeSelect.value);
    applyTheme(nextThemeMode);
    chrome.storage.sync.set({ themeMode: nextThemeMode });
  });
});
