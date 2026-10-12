// Exhaust every status pair to check relationships between funnel helpers.
// The separate contract suite pins their tables to the server.
import { describe, expect, it } from "vitest";

import {
  ACTIVE_STATUSES,
  activeRank,
  canSet,
  correctionMoves,
  forwardMoves,
  isBackwardMove,
  isForwardMove,
  isTerminal,
  pickableMoves,
  settableChoices,
  type Status,
  TERMINAL_STATUSES,
} from "./index";

const EVERY_STATUS: Status[] = [...ACTIVE_STATUSES, ...TERMINAL_STATUSES];

describe("funnel properties", () => {
  it("forwardMoves never includes the current status itself", () => {
    for (const status of EVERY_STATUS) {
      expect(forwardMoves(status)).not.toContain(status);
    }
  });

  it("a terminal status has no forward moves", () => {
    for (const status of TERMINAL_STATUSES) {
      expect(forwardMoves(status)).toEqual([]);
    }
  });

  it("every forward move from an active status lands deeper in the funnel or on a terminal", () => {
    for (const status of ACTIVE_STATUSES) {
      const rank = activeRank(status)!;
      for (const target of forwardMoves(status)) {
        if (isTerminal(target)) continue;
        expect(activeRank(target)!).toBeGreaterThan(rank);
      }
    }
  });

  it("isForwardMove agrees with forwardMoves for every (current, target) pair", () => {
    for (const current of EVERY_STATUS) {
      const forward = new Set<string>(forwardMoves(current));
      for (const target of EVERY_STATUS) {
        expect(isForwardMove(current, target)).toBe(forward.has(target));
      }
    }
  });

  it("a forward move is never also a backward move", () => {
    for (const current of EVERY_STATUS) {
      for (const target of forwardMoves(current)) {
        expect(isBackwardMove(current, target)).toBe(false);
      }
    }
  });

  it("correctionMoves is the exact complement of forwardMoves (minus current itself)", () => {
    for (const current of EVERY_STATUS) {
      const forward = new Set<string>(forwardMoves(current));
      const correction = new Set(correctionMoves(current));
      expect(correction.has(current)).toBe(false);
      for (const status of EVERY_STATUS) {
        if (status === current) continue;
        expect(correction.has(status)).toBe(!forward.has(status));
      }
    }
  });

  it("pickableMoves is always a subset of forwardMoves", () => {
    for (const current of EVERY_STATUS) {
      const forward = new Set(forwardMoves(current));
      for (const status of pickableMoves(current)) {
        expect(forward.has(status)).toBe(true);
      }
    }
  });

  it("settableChoices is always a subset of forwardMoves, and canSet agrees with it", () => {
    for (const current of EVERY_STATUS) {
      const forward = new Set<string>(forwardMoves(current));
      const settable = new Set<string>(settableChoices(current));
      for (const status of settable) {
        expect(forward.has(status)).toBe(true);
      }
      for (const target of EVERY_STATUS) {
        expect(canSet(current, target)).toBe(settable.has(target));
      }
    }
  });

  it("activeRank is strictly increasing over ACTIVE_STATUSES and undefined for terminals", () => {
    const ranks = ACTIVE_STATUSES.map((s) => activeRank(s)!);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThan(ranks[i - 1]);
    }
    for (const status of TERMINAL_STATUSES) {
      expect(activeRank(status)).toBeUndefined();
    }
  });
});
