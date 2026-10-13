export const EASY_APPLY_ENABLED_KEY = "easyApplyEnabled";
export const EASY_APPLY_DEFAULT_ENABLED = true;
export const EASY_APPLY_SUMMARY_OPEN_KEY = "easyApplySummaryOpen";

export function loadEasyApplyEnabled(callback: (enabled: boolean) => void): void {
  chrome.storage.local.get(EASY_APPLY_ENABLED_KEY, (data) => {
    callback(
      typeof data[EASY_APPLY_ENABLED_KEY] === "boolean"
        ? data[EASY_APPLY_ENABLED_KEY]
        : EASY_APPLY_DEFAULT_ENABLED,
    );
  });
}

export function saveEasyApplyEnabled(enabled: boolean, callback?: () => void): void {
  if (callback) chrome.storage.local.set({ [EASY_APPLY_ENABLED_KEY]: enabled }, callback);
  else void chrome.storage.local.set({ [EASY_APPLY_ENABLED_KEY]: enabled });
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
