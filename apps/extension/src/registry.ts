// Type-only adapter imports break the engine/adapter cycle. content.ts installs
// the priority-ordered adapters; the engine and adapters share this registry.
import type { Adapter, NaturalKey } from "./adapters/types";

let adapters: Adapter[] = [];

/** Install the active adapter set. Called once at startup by the entry point. */
export function setAdapters(list: Adapter[]) {
  adapters = list;
}

/** The active adapters, in priority order (used by the scan loop to pick one). */
export function getAdapters(): Adapter[] {
  return adapters;
}

// Render keys are extension-local. Each adapter resolves its own prefix to an API natural key.
export function toNaturalKey(jobId: string): NaturalKey | null {
  for (const adapter of adapters) {
    const key = adapter.naturalKey?.(jobId);
    if (key) return key;
  }
  return null;
}
