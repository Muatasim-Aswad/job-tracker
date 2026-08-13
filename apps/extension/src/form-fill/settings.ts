export const EASY_APPLY_ENABLED_KEY = "easyApplyEnabled";
export const EASY_APPLY_DEFAULT_ENABLED = true;

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
