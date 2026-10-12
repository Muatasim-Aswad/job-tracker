// Compare the TypeScript mirror with the server-generated funnel contract.
// A server rule change regenerates the fixture; both suites require reviewing drift.
import { describe, expect, it } from "vitest";

import contract from "./funnel.contract.json";
import { ACTIVE_STATUSES, forwardMoves, TERMINAL_STATUSES } from "./index";

const forwardByStatus = contract.forwardMoves as Record<string, string[]>;

describe("funnel contract", () => {
  it("mirrors the server's active/terminal status order", () => {
    expect([...ACTIVE_STATUSES]).toEqual(contract.active);
    expect([...TERMINAL_STATUSES]).toEqual(contract.terminal);
    expect([...ACTIVE_STATUSES, ...TERMINAL_STATUSES]).toEqual(contract.statuses);
  });

  it("mirrors the server's forward-move adjacency for every status", () => {
    for (const status of contract.statuses) {
      expect(forwardMoves(status)).toEqual(forwardByStatus[status]);
    }
  });
});
