// System uses the media query; explicit themes override it with data-theme.
// Persist in chrome.storage and apply before mounting to avoid a flash.
export type Theme = "system" | "light" | "dark";

export const THEME_KEY = "theme";

// Cycle order for the toggle: system → light → dark → system.
export const NEXT_THEME: Record<Theme, Theme> = {
  system: "light",
  light: "dark",
  dark: "system",
};

// Stamp (or clear) the <html> data-theme attribute. `system` clears it so the
// media-query default takes over; an explicit choice sets it and wins.
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  else delete root.dataset.theme;
}

// Advance the persisted theme one step, apply it live, and store it. Shared by the
// settings ThemeToggle and the popup's `t` shortcut; ThemeToggle picks the change up
// via chrome.storage.onChanged, so callers don't report back to it.
export function cycleTheme(): void {
  chrome.storage.local.get(THEME_KEY, (data) => {
    const next = NEXT_THEME[(data[THEME_KEY] as Theme) || "system"];
    applyTheme(next);
    void chrome.storage.local.set({ [THEME_KEY]: next });
  });
}
