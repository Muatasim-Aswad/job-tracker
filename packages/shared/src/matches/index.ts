// Presentation of duplicate-match evidence, shared by the extension popover and the
// dashboard relink view so both name and phrase every check the same way.
import type { components } from "../api/schema";

type Schemas = components["schemas"];
export type MatchInsights = Schemas["MatchInsights"];
export type MatchTiming = Schemas["MatchTiming"];
type InsightKey = keyof MatchInsights;

export const APPLY_TYPE_LABELS: Record<string, string> = {
  easy_apply: "Easy apply",
  external: "External apply",
};

// Strongest identity evidence first.
const INSIGHT_LABELS: [InsightKey, string][] = [
  ["apply_url", "Apply link"],
  ["company_url", "Company page"],
  ["poster", "Poster"],
  ["location", "Location"],
  ["workplace", "Workplace"],
  ["salary", "Salary"],
  ["apply_type", "Apply type"],
];

export type EvidenceRow =
  | { key: InsightKey; label: string; same: true }
  | { key: InsightKey; label: string; same: false; current: string; candidate: string };

function displayValue(key: InsightKey, value: string): string {
  return key === "apply_type" ? (APPLY_TYPE_LABELS[value] ?? value) : value;
}

/** Comparable checks in display order; fields either side lacks are omitted. */
export function evidenceRows(insights: MatchInsights | null | undefined): EvidenceRow[] {
  const rows: EvidenceRow[] = [];
  for (const [key, label] of INSIGHT_LABELS) {
    const insight = insights?.[key];
    if (!insight) continue;
    rows.push(
      insight.is_same
        ? { key, label, same: true }
        : {
            key,
            label,
            same: false,
            current: displayValue(key, insight.current),
            candidate: displayValue(key, insight.candidate),
          },
    );
  }
  return rows;
}

/** When this posting appeared relative to the candidate's last closure. */
export function timingText(timing: MatchTiming | null | undefined): string | null {
  if (!timing) return null;
  if (timing.overlapping) return "Open at the same time";
  const days = timing.gap_days ?? 0;
  if (days === 0) return "Reposted the day it closed";
  return `Reposted ${days} day${days === 1 ? "" : "s"} after it closed`;
}

/** Whole-percent description overlap, or null when no comparison was possible. */
export function similarityPercent(similarity: number | null | undefined): number | null {
  return similarity == null ? null : Math.round(similarity * 100);
}
