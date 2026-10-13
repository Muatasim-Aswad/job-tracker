// A failed status write must restore the authoritative selection.
import { describe, expect, it, vi } from "vitest";

import { createStatusSelect } from "./statusSelect";
import type { Engine } from "./types";
import type { JobState } from "../messages";

function makeEngine(emitResult: JobState | null) {
  const emit = vi.fn(async () => emitResult);
  const engine = {
    stateOf: () => ({ status: "seen", hidden: false, starred: false }) as JobState,
    emit,
  } as unknown as Engine;
  const slice = createStatusSelect(engine);
  return { engine, emit, slice };
}

// Build a populated select sitting at "seen" (the header) with the forward moves as
// options, exactly as updateControls would leave it before a user interacts.
function seededSelect(slice: ReturnType<typeof createStatusSelect>) {
  const select = slice.makeStatusSelect("job1");
  slice.syncStatusSelect(select, "seen");
  return select;
}

describe("status <select> change", () => {
  it("snaps back to the current status when the write fails", async () => {
    const { emit, slice } = makeEngine(null); // failed write
    const select = seededSelect(slice);

    select.value = "applied";
    select.dispatchEvent(new Event("change"));
    await Promise.resolve(); // let the emit().then chain settle

    expect(emit).toHaveBeenCalledWith("job1", "applied");
    // syncStatusSelect re-selects the disabled header after re-deriving from "seen".
    expect(select.value).toBe("__current");
  });

  it("leaves the change to the normal render path when the write succeeds", async () => {
    const succeeded: JobState = { status: "applied", hidden: false, starred: false };
    const { emit, slice } = makeEngine(succeeded);
    const select = seededSelect(slice);

    select.value = "applied";
    select.dispatchEvent(new Event("change"));
    await Promise.resolve();

    expect(emit).toHaveBeenCalledWith("job1", "applied");
    // No snap-back on success — the value stays where the user put it (renderJob
    // repaints it authoritatively in the real flow).
    expect(select.value).toBe("applied");
  });
});
