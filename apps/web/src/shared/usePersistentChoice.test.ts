import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePersistentChoice } from "./usePersistentChoice";

const choices = ["first", "second"] as const;

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("usePersistentChoice", () => {
  it("reads and updates a valid stored preference", () => {
    localStorage.setItem("preference", "second");
    const { result } = renderHook(() => usePersistentChoice("preference", choices, "first"));

    expect(result.current[0]).toBe("second");
    act(() => result.current[1]("first"));
    expect(result.current[0]).toBe("first");
    expect(localStorage.getItem("preference")).toBe("first");
  });

  it("replaces an obsolete stored value with the default", () => {
    localStorage.setItem("preference", "removed-choice");
    const { result } = renderHook(() => usePersistentChoice("preference", choices, "first"));

    expect(result.current[0]).toBe("first");
    expect(localStorage.getItem("preference")).toBe("first");
  });
});
