import type { PreferencesState } from "@job-tracker/shared/api";
import { loadPreferences } from "../preferences.js";
import { sanitizePolicy, setActivePolicy, setTitleRules } from "./keywords.js";

export function applyKeywordPreferences(state: PreferencesState | null): void {
  const highlights = state?.settings.description_highlights ?? [];
  setActivePolicy(
    sanitizePolicy(
      highlights.map((signal) => ({ ...signal, scope: "description", action: "banner" })),
    ).map((signal) => ({
      ...signal,
      enabled:
        signal.action === "banner" &&
        highlights.some((item) => item.id === signal.id && item.enabled),
    })),
  );
  setTitleRules(state?.settings.title_rules ?? []);
}

export function loadKeywordPolicy(callback?: () => void): void {
  void loadPreferences()
    .then((state) => {
      applyKeywordPreferences(state);
      callback?.();
    })
    .catch(() => {});
}
