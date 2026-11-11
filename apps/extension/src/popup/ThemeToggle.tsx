import { copy } from "./copy";
import { useEffect, useState } from "react";
import { ICON } from "../icons.js";
import { cycleTheme, THEME_KEY, type Theme } from "./theme.js";
import { ACTION_BUTTON, ICON as ICON_CLASS } from "./ui";

// Cycle the persisted system/light/dark theme and apply it immediately.
const FACE: Record<Theme, { icon: string; text: string }> = {
  system: { icon: ICON.monitor, text: copy.themeToggle.system },
  light: { icon: ICON.sun, text: copy.themeToggle.light },
  dark: { icon: ICON.moon, text: copy.themeToggle.dark },
};

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  // Track storage changes from both this control and the popup's theme shortcut.
  useEffect(() => {
    chrome.storage.local.get(THEME_KEY, (data) => {
      setTheme((data[THEME_KEY] as Theme) || "system");
    });
    const onChanged = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area === "local" && changes[THEME_KEY]) {
        setTheme((changes[THEME_KEY].newValue as Theme) || "system");
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const f = FACE[theme];
  return (
    <button
      className={ACTION_BUTTON}
      title={copy.themeToggle.themeSystemFollowsYourOSClickToCycleSystem}
      aria-label={copy.themeToggle.themeClickToChange(f.text)}
      onClick={cycleTheme}
    >
      <span className={ICON_CLASS} dangerouslySetInnerHTML={{ __html: f.icon }} />
      {f.text}
    </button>
  );
}
