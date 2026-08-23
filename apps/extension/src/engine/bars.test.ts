import { describe, expect, it, vi } from "vitest";

import { createBars, isListDeemphasized } from "./bars";
import type { Engine } from "./types";

describe("list-card display state", () => {
  it.each(["to_apply", "applied", "in_process", "offered", "skipped", "rejected"])(
    "deemphasizes %s without requiring a hidden flag",
    (status) => {
      expect(isListDeemphasized(status)).toBe(true);
    },
  );

  it.each(["untracked", "new", "seen"])("keeps %s in discovery lists", (status) => {
    expect(isListDeemphasized(status)).toBe(false);
  });
});

describe("hidden flag action", () => {
  it.each([
    [false, "hidden"],
    [true, "unhidden"],
  ])("toggles hidden=%s with %s", async (hidden, event) => {
    const emit = vi.fn(async () => null);
    const engine = {
      stateOf: () => ({ status: "seen", hidden, starred: false }),
      emit,
    } as unknown as Engine;

    await createBars(engine).toggleHidden("LI-1");

    expect(emit).toHaveBeenCalledWith("LI-1", event);
  });
});
