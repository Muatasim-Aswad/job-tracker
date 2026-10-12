// Anchor relative dates at capture time; exact dates come from machine-readable evidence.
// Missing evidence stays null, and adapters retain raw age separately. Shared time logic owns parsing.
import { parseRelativeAge, type PostedPrecision } from "@job-tracker/shared/time";

export interface PostedFields {
  at: string | null;
  precision: PostedPrecision | null;
}

function unknown(): PostedFields {
  return { at: null, precision: null };
}

/** Normalize a trusted machine-readable posting date to UTC. */
export function postedFromExact(raw: string | null | undefined): PostedFields {
  if (!raw) return unknown();
  const d = new Date(raw);
  return isNaN(d.getTime()) ? unknown() : { at: d.toISOString(), precision: "exact" };
}

/** A rendered relative age ("17 days ago"), anchored to the capture instant. */
export function postedFromRelative(
  raw: string | null | undefined,
  capturedAt: string,
): PostedFields {
  const parsed = raw ? parseRelativeAge(raw, capturedAt) : null;
  return parsed ? { at: parsed.at, precision: parsed.precision } : unknown();
}
