import { Check, X } from "lucide-react";
import type { JobMatch } from "@job-tracker/shared/api";
import {
  evidenceRows,
  similarityPercent,
  timingText,
  type EvidenceRow,
} from "@job-tracker/shared/matches";
import { fmtDate } from "@job-tracker/shared/time";
import { StatusBadge } from "../StatusBadge";

interface Props {
  match: JobMatch;
  onChoose: () => void;
}

// Show complete evidence before the relink decision.
export function MatchCandidateCard({ match: m, onChoose }: Props) {
  const evidence = evidenceRows(m.insights);
  const timing = timingText(m.timing);
  const facts = [
    m.company,
    `${m.listing_count} listing${m.listing_count === 1 ? "" : "s"}`,
    `Tracked ${fmtDate(m.created_at)}`,
    m.closed_at ? `Closed ${fmtDate(m.closed_at)}` : null,
  ].filter(Boolean);

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-violet-500/30 bg-surface p-3">
      <div className="flex items-start gap-3">
        <SimilarityChip similarity={m.similarity} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start gap-2">
            <span className="min-w-0 flex-1 text-sm font-medium text-ink">
              {m.title ?? "(untitled)"}
            </span>
            <StatusBadge status={m.status} />
          </div>
          <span className="text-xs text-ink-muted">{facts.join(" · ")}</span>
          {timing && <span className="text-xs text-ink-soft">{timing}</span>}
        </div>
      </div>

      {evidence.length > 0 && (
        <ul aria-label="Evidence" className="flex flex-col gap-1">
          {evidence.map((row) => (
            <EvidenceItem key={row.key} row={row} />
          ))}
        </ul>
      )}

      <button
        onClick={onChoose}
        className="self-end rounded border border-violet-500/40 px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-500/10 dark:text-violet-300"
      >
        Relink here
      </button>
    </article>
  );
}

const SIMILARITY_TONE = {
  high: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  mid: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  low: "bg-slate-500/15 text-ink-soft",
};

function SimilarityChip({ similarity }: { similarity: number | null }) {
  const percent = similarityPercent(similarity);
  if (percent === null) {
    return (
      <span
        title="No description captured on one side to compare"
        className="w-14 shrink-0 rounded border border-line py-1 text-center text-xs text-ink-faint"
      >
        –
      </span>
    );
  }
  const tone = percent >= 70 ? "high" : percent >= 40 ? "mid" : "low";
  return (
    <span
      title={`${percent}% job-description overlap with this listing`}
      className={`w-14 shrink-0 rounded py-1 text-center text-xs font-semibold ${SIMILARITY_TONE[tone]}`}
    >
      {percent}%
    </span>
  );
}

function EvidenceItem({ row }: { row: EvidenceRow }) {
  return (
    <li className="flex min-w-0 items-start gap-2 text-xs">
      {row.same ? (
        <Check size={14} aria-label="Same" className="mt-px shrink-0 text-emerald-600" />
      ) : (
        <X size={14} aria-label="Different" className="mt-px shrink-0 text-amber-600" />
      )}
      <span className="w-24 shrink-0 text-ink-soft">{row.label}</span>
      {!row.same && (
        <span className="flex min-w-0 flex-1 flex-col text-ink-muted">
          <span title={row.current} className="truncate">
            This: {row.current}
          </span>
          <span title={row.candidate} className="truncate">
            Theirs: {row.candidate}
          </span>
        </span>
      )}
    </li>
  );
}
