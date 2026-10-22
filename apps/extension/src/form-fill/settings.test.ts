import { afterEach, describe, expect, it } from "vitest";
import {
  EASY_APPLY_SUMMARY_OPEN_KEY,
  loadEasyApplySummaryOpen,
  saveEasyApplySummaryOpen,
} from "./settings";

function installStorage(seed: Record<string, unknown> = {}) {
  const store = { ...seed };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: (key: string, callback: (data: Record<string, unknown>) => void) =>
          callback(key in store ? { [key]: store[key] } : {}),
        set: (values: Record<string, unknown>, callback?: () => void) => {
          Object.assign(store, values);
          callback?.();
        },
      },
    },
  };
  return store;
}

afterEach(() => delete (globalThis as unknown as { chrome?: unknown }).chrome);

describe("Easy Apply summary preference", () => {
  it("has no stored override by default", () => {
    const store = installStorage();
    let open: boolean | undefined = true;
    loadEasyApplySummaryOpen((value) => (open = value));
    expect(open).toBeUndefined();
    expect(store).toEqual({});
  });

  it("persists the user's open or collapsed choice", () => {
    const store = installStorage();
    saveEasyApplySummaryOpen(false);
    expect(store[EASY_APPLY_SUMMARY_OPEN_KEY]).toBe(false);
    let open: boolean | undefined;
    loadEasyApplySummaryOpen((value) => (open = value));
    expect(open).toBe(false);
  });
});
