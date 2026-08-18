import { describe, expect, it } from "vitest";

import { isListDeemphasized } from "./bars";

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
