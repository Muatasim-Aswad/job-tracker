import { afterEach, describe, expect, it } from "vitest";
import {
  EASY_APPLY_DEFAULT_ENABLED,
  EASY_APPLY_ENABLED_KEY,
  EASY_APPLY_SUMMARY_OPEN_KEY,
  loadEasyApplyEnabled,
  loadEasyApplySummaryOpen,
  saveEasyApplyEnabled,
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

describe("Easy Apply switch", () => {
  it("defaults on without writing browser storage", () => {
    const store = installStorage();
    let enabled = false;
    loadEasyApplyEnabled((value) => (enabled = value));
    expect(enabled).toBe(EASY_APPLY_DEFAULT_ENABLED);
    expect(store).toEqual({});
  });

  it("persists the user's choice", () => {
    const store = installStorage();
    saveEasyApplyEnabled(false);
    expect(store[EASY_APPLY_ENABLED_KEY]).toBe(false);
    let enabled = true;
    loadEasyApplyEnabled((value) => (enabled = value));
    expect(enabled).toBe(false);
  });
});

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
