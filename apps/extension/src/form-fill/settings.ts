import { loadPreferences } from "../preferences.js";

export const EASY_APPLY_SUMMARY_OPEN_KEY = "easyApplySummaryOpen";

export function loadEasyApplyEnabled(callback: (enabled: boolean) => void): void {
  void loadPreferences()
    .then((state) => callback(state.settings.easy_apply_enabled))
    .catch(() => callback(false));
}

export function loadEasyApplySummaryOpen(callback: (open: boolean | undefined) => void): void {
  chrome.storage.local.get(EASY_APPLY_SUMMARY_OPEN_KEY, (data) => {
    const value = data[EASY_APPLY_SUMMARY_OPEN_KEY];
    callback(typeof value === "boolean" ? value : undefined);
  });
}

export function saveEasyApplySummaryOpen(open: boolean, callback?: () => void): void {
  if (callback) chrome.storage.local.set({ [EASY_APPLY_SUMMARY_OPEN_KEY]: open }, callback);
  else void chrome.storage.local.set({ [EASY_APPLY_SUMMARY_OPEN_KEY]: open });
}
