import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { Listing } from "@job-tracker/shared/api";
import { STATUS_ACCENT } from "@job-tracker/shared/funnel";
import { platformLabel } from "@job-tracker/shared/platforms";
import { useJobMatches, useJobs } from "../../hooks";
import { EmptyBlock } from "../EmptyBlock";
import { IconButton } from "../IconButton";
import { SectionHeader } from "../SectionHeader";
import { ICON_SIZE, NEUTRAL } from "./constants";
import { MatchCandidateCard } from "./MatchCandidateCard";

interface Props {
  listing: Listing;
  jobTitle: string | null;
  jobCompany: string | null;
  dissolvesSource: boolean;
  onPick: (jobId: string) => void;
  onBack: () => void;
}

interface Target {
  id: string;
  title: string | null;
  company: string | null;
}

const OTHER_JOBS_LIMIT = 12;

function matchesQuery(needle: string, title: string | null, company: string | null): boolean {
  return (
    !needle ||
    (title ?? "").toLowerCase().includes(needle) ||
    (company ?? "").toLowerCase().includes(needle)
  );
}

// Relinking moves attributed events and may dissolve the source job; require confirmation.
export function RelinkView({
  listing,
  jobTitle,
  jobCompany,
  dissolvesSource,
  onPick,
  onBack,
}: Props) {
  const { data: jobs } = useJobs();
  const { data: candidates, isLoading } = useJobMatches(
    listing.platform,
    listing.platform_id,
    jobTitle ?? listing.title ?? "",
    jobCompany ?? listing.company ?? "",
  );
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<Target | null>(null);
  const needle = q.trim().toLowerCase();

  const shownCandidates = useMemo(
    () => (candidates ?? []).filter((m) => matchesQuery(needle, m.title, m.company)),
    [candidates, needle],
  );

  const otherJobs = useMemo(() => {
    const candidateIds = new Set((candidates ?? []).map((m) => m.job_id));
    return (jobs ?? [])
      .filter((j) => j.id !== listing.job_id && !candidateIds.has(j.id))
      .filter((j) => matchesQuery(needle, j.title, j.company))
      .slice(0, OTHER_JOBS_LIMIT);
  }, [jobs, candidates, listing.job_id, needle]);

  return (
    <div
      className="flex flex-col gap-6 p-6"
      onKeyDown={(e) => {
        // Escape first backs out of the confirm step; the drawer handles the rest.
        if (e.key === "Escape" && target) {
          e.stopPropagation();
          setTarget(null);
        }
      }}
    >
      <header className="sticky top-0 z-20 -mx-6 -mt-6 flex items-start gap-2 border-b border-line bg-canvas px-6 pb-3 pt-6">
        <IconButton label="Back to job" onClick={onBack} className={NEUTRAL}>
          <ArrowLeft size={ICON_SIZE} />
        </IconButton>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-ink">Relink listing</h2>
          <p className="truncate text-sm text-ink-muted">
            {platformLabel(listing.platform)} · {listing.title ?? jobTitle ?? "(untitled)"}
          </p>
        </div>
      </header>

      {target ? (
        <section className="flex flex-col gap-3 rounded-lg border border-violet-500/30 bg-violet-500/5 p-4">
          <p className="text-sm text-ink-soft">
            Move this listing to{" "}
            <span className="font-medium text-ink">{target.title ?? "(untitled)"}</span>
            {target.company ? <span className="text-ink-muted"> · {target.company}</span> : null}?
          </p>
          <p className="text-xs text-ink-muted">
            Its events move with it.{" "}
            {dissolvesSource && (
              <span className="text-amber-700 dark:text-amber-400">
                This is the current job’s only listing, so that job will be removed.
              </span>
            )}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => onPick(target.id)}
              className="rounded bg-violet-600 px-2 py-1 text-xs font-medium text-white hover:bg-violet-700"
            >
              Relink
            </button>
            <button
              onClick={() => setTarget(null)}
              className="rounded px-2 py-1 text-xs text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : (
        <>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search jobs to relink this listing to"
            placeholder="Search title or company…"
            autoFocus
            className="rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink"
          />

          <section>
            <SectionHeader title="Likely duplicates" count={shownCandidates.length} />
            <div className="flex flex-col gap-2">
              {shownCandidates.map((m) => (
                <MatchCandidateCard
                  key={m.job_id}
                  match={m}
                  onChoose={() => setTarget({ id: m.job_id, title: m.title, company: m.company })}
                />
              ))}
              {shownCandidates.length === 0 && (
                <EmptyBlock
                  message={isLoading ? "Looking for duplicates…" : "No likely duplicates."}
                />
              )}
            </div>
          </section>

          <section>
            <SectionHeader title="Other jobs" />
            <div className="flex flex-col gap-0.5">
              {otherJobs.map((j) => (
                <button
                  key={j.id}
                  onClick={() => setTarget({ id: j.id, title: j.title, company: j.company })}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface-hover"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${STATUS_ACCENT[j.status].dot}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {j.title ?? "(untitled)"}
                  </span>
                  <span className="max-w-[40%] shrink-0 truncate text-ink-muted">
                    {j.company ?? "—"}
                  </span>
                </button>
              ))}
              {otherJobs.length === 0 && <EmptyBlock message="No other jobs match." />}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
