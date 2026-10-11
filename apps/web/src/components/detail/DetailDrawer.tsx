import { useEffect, useRef, useState } from "react";
import { formKeys } from "../../lib/forms";
import { useFocusTrap, useScrollLock } from "../../lib/useFocusTrap";
import { describeError, toast } from "../../lib/toast";
import { ArrowRight, Copy, Eye, EyeOff, Pencil, Star, Undo2, Wrench, X } from "lucide-react";
import type { Attention, EventItem } from "@job-tracker/shared/api";
import {
  useCorrectStatus,
  useDeleteJob,
  useDeleteListing,
  useJob,
  useRelinkListing,
  useRevertStatus,
  useUpdateJob,
  useUpdateListing,
} from "../../hooks";
import { flagEvent, isStatusSettingEvent, pickableMoves } from "@job-tracker/shared/funnel";
import { fmtDate, fmtSpan } from "@job-tracker/shared/time";
import { Documents } from "../Documents";
import { EmptyBlock } from "../EmptyBlock";
import { IconButton } from "../IconButton";
import { InlineConfirm } from "../InlineConfirm";
import { MetaEditor } from "../MetaEditor";
import { MetaLine } from "../MetaLine";
import { CollapsibleSection } from "../CollapsibleSection";
import { usePersistentStringSet } from "../../lib/persist";
import { StatusBadge } from "../StatusBadge";
import { Timeline } from "../Timeline";
import { CorrectPanel } from "./CorrectPanel";
import { AttentionPanel } from "./AttentionPanel";
import { ICON_SIZE, NEUTRAL } from "./constants";
import { ListingCard } from "./ListingCard";
import { MovePanel } from "./MovePanel";

interface Props {
  jobId: string;
  attention: Attention | null;
  onClose: () => void;
  onEvent: (jobId: string, events: EventItem[]) => void;
  // Open a different job in the drawer — used after relinking a listing, to follow
  // it to (and confirm the merge into) its new home.
  onNavigate: (jobId: string) => void;
}

// How long the job has been in its current stage. `fmtSpan` says "just now" under
// a minute, which doesn't compose with a trailing "in this stage".
function stageSpan(since: string): string {
  const span = fmtSpan(since);
  return span === "just now" ? "<1m" : span;
}

// A status action that doesn't apply to *this* job stays in the toolbar, greyed,
// with the reason appended to its label — hiding it made the toolbar reflow between
// jobs, so the same control sat under a different pixel on every job.
//
// `aria-disabled` rather than `disabled` on purpose: a `disabled` button leaves the
// tab order AND stops firing pointer events, so neither the keyboard nor the hover
// tooltip could reach the reason — the one thing the state exists to communicate.
// The click is inert instead, guarded at the handler.
function unavailable(reason: string | null, tone: string) {
  return {
    "aria-disabled": !!reason,
    // An unavailable control also drops its tone: an amber "correct" or red "undo"
    // reads as armed, and nothing that can't be used should look armed.
    className: reason ? `${NEUTRAL} cursor-not-allowed opacity-50` : tone,
  };
}

export function DetailDrawer({ jobId, attention, onClose, onEvent, onNavigate }: Props) {
  const { data: job, isLoading, isError, isFetching, refetch } = useJob(jobId);
  const updateJob = useUpdateJob();
  const deleteJob = useDeleteJob();
  const deleteListing = useDeleteListing();
  const relinkListing = useRelinkListing();
  const updateListing = useUpdateListing();
  const correctStatus = useCorrectStatus();
  const revertStatus = useRevertStatus();

  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [editing, setEditing] = useState(false);
  const [collapsedSections, toggleSection] = usePersistentStringSet("jt.collapsedJobSections");
  const disclosure = (section: string) => ({
    collapsed: collapsedSections.has(section),
    onToggle: () => toggleSection(section),
  });

  // Which status action owns the panel below the toolbar. At most one is open, so
  // opening one closes the others (see the toolbar handlers). Move/Correct keep
  // their own field state inside their panels; only "which is open" lives here.
  const [moving, setMoving] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  // Undo is armed on first click, applied on the second — a status change is not
  // something to fire on a stray click.
  const [undoArming, setUndoArming] = useState(false);
  const [addNoteRequest, setAddNoteRequest] = useState<{ jobId: string; token: number } | null>(
    null,
  );

  // The dialog surface — the root of the focus trap and initial focus target.
  const asideRef = useRef<HTMLElement>(null);

  // Persist the header title/company edit — shared by the Save button and
  // formKeys' Cmd+Enter so the write lives in one place.
  function saveHeader() {
    updateJob.mutate({ jobId, body: { title, company } });
    setEditing(false);
  }

  // Clipboard writes can fail because of permissions or an insecure origin, so
  // report their settled result rather than acknowledging the click.
  async function copyJson() {
    if (!job) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(job, null, 2));
      toast.info("Copied the full response JSON.");
    } catch (err) {
      toast.error(`Couldn’t copy to the clipboard. ${describeError(err)}`);
    }
  }

  useEffect(() => {
    if (job) {
      setTitle(job.title ?? "");
      setCompany(job.company ?? "");
    }
  }, [job]);

  // Modal dialog behavior: focus into the drawer on open, trap Tab inside it,
  // close on Escape, and hand focus back to the card that opened it on close.
  useFocusTrap(asideRef, onClose);
  // …and freeze the board behind it, so the drawer is the only thing that scrolls.
  useScrollLock();

  // The organic forward moves available from the current status (advancing the
  // funnel or reaching a terminal). Backward moves are corrections, not here.
  const moves = job ? pickableMoves(job.status) : [];
  const canUndo = !!job && job.events.some((e) => isStatusSettingEvent(e.event));

  // Why a status action can't be used on this job. `null` means it can. The string
  // replaces the button's label wholesale, so the reason is the accessible name and
  // the hover text both — see `unavailable`.
  const moveReason = moves.length === 0 ? "Move forward — this job is at a terminal outcome" : null;
  const undoReason = canUndo ? null : "Undo the last status change — there hasn’t been one yet";

  // When the job entered its current stage: the newest status-setting event, or
  // its birth if it's never moved. Drives the "in stage for Nd" read.
  const stageSince = job
    ? (job.events
        .filter((e) => isStatusSettingEvent(e.event))
        .map((e) => e.ts)
        .sort()
        .at(-1) ?? job.created_at)
    : undefined;

  // The explicit way out. Esc and the backdrop still work, but neither is visible,
  // and a touch user has no Esc at all. Present in every branch — the error state
  // is where being unable to leave is worst.
  const closeButton = (
    <IconButton label="Close" onClick={onClose} className={NEUTRAL}>
      <X size={ICON_SIZE} />
    </IconButton>
  );

  return (
    <div className="fixed inset-0 z-20 flex justify-end">
      <div className="flex-1 bg-overlay" onClick={onClose} />
      <aside
        ref={asideRef}
        role="dialog"
        aria-modal="true"
        aria-label={job ? `${job.title ?? "Job"} details` : "Job details"}
        tabIndex={-1}
        className="flex w-lg max-w-full flex-col overflow-y-auto border-l border-line bg-canvas shadow-2xl outline-none"
      >
        {isError ? (
          <div className="flex flex-col items-start gap-3 p-6 text-sm text-ink-muted">
            <div className="flex w-full items-start justify-between gap-3">
              <span>Couldn’t load this job.</span>
              {closeButton}
            </div>
            <button
              onClick={() => void refetch()}
              disabled={isFetching}
              className="rounded border border-line bg-surface px-2 py-1 text-xs font-medium text-ink hover:bg-surface-hover disabled:opacity-50"
            >
              {isFetching ? "Retrying…" : "Retry"}
            </button>
          </div>
        ) : isLoading || !job ? (
          <div className="flex items-start justify-between gap-3 p-6 text-sm text-ink-muted">
            <span>Loading…</span>
            {closeButton}
          </div>
        ) : (
          <div className="flex flex-col gap-6 p-6">
            <header className="sticky top-0 z-20 -mx-6 -mt-6 flex flex-col gap-1 border-b border-line bg-canvas px-6 pb-3 pt-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {editing ? (
                    <div
                      className="flex flex-col gap-2"
                      onKeyDown={formKeys(saveHeader, () => setEditing(false))}
                    >
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        aria-label="Job title"
                        placeholder="Title"
                        autoFocus
                        className="rounded border border-line bg-surface px-2 py-1 text-sm text-ink"
                      />
                      <input
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                        aria-label="Company"
                        placeholder="Company"
                        className="rounded border border-line bg-surface px-2 py-1 text-sm text-ink"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={saveHeader}
                          className="rounded bg-violet-600 px-2 py-1 text-xs font-medium text-white hover:bg-violet-700"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditing(false)}
                          className="rounded px-2 py-1 text-xs text-ink-muted hover:text-ink"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    // The drawer IS the detail view: a title clipped here was
                    // readable nowhere else short of opening the edit form. Two
                    // lines rather than unbounded wrap, because the header is
                    // sticky and a five-line title would eat the viewport; the
                    // `title` attribute carries whatever the second line can't.
                    <h2
                      title={job.title ?? undefined}
                      className="line-clamp-2 text-lg font-semibold text-ink"
                    >
                      {job.title ?? "(untitled)"}
                    </h2>
                  )}
                </div>
                {closeButton}
              </div>
              <div className="flex min-w-0 items-center justify-between gap-3">
                {!editing && (
                  <div className="flex min-w-0 items-center gap-1">
                    <div
                      title={job.company ?? undefined}
                      className="min-w-0 truncate text-sm text-ink-muted"
                    >
                      {job.company ?? "—"}
                    </div>
                    <IconButton
                      label="Edit title / company"
                      onClick={() => setEditing(true)}
                      className={`${NEUTRAL} shrink-0`}
                    >
                      <Pencil size={ICON_SIZE} />
                    </IconButton>
                  </div>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-0.5">
                  <IconButton
                    label={job.starred ? "Unstar" : "Star"}
                    onClick={() => onEvent(jobId, [{ event: flagEvent("starred", job.starred) }])}
                    className={job.starred ? "text-amber-600 dark:text-amber-400" : NEUTRAL}
                  >
                    <Star size={ICON_SIZE} fill={job.starred ? "currentColor" : "none"} />
                  </IconButton>
                  <IconButton
                    label={job.hidden ? "Hidden from board — click to unhide" : "Hide from board"}
                    active={job.hidden}
                    onClick={() => onEvent(jobId, [{ event: flagEvent("hidden", job.hidden) }])}
                    className={job.hidden ? "text-ink" : NEUTRAL}
                  >
                    {job.hidden ? <EyeOff size={ICON_SIZE} /> : <Eye size={ICON_SIZE} />}
                  </IconButton>
                  {/* The full name distinguishes this debugging action from copy-JD. */}
                  <IconButton
                    label="Copy full response JSON"
                    onClick={() => void copyJson()}
                    className={`ml-2 ${NEUTRAL}`}
                  >
                    <Copy size={ICON_SIZE} />
                  </IconButton>
                </div>
              </div>
            </header>

            {/* Status — current state plus its actions (move / undo / correct) as a
                compact icon toolbar; each action that needs input opens a panel below. */}
            <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface/40 p-4">
              <div className="flex items-center gap-2">
                <StatusBadge status={job.status} size="md" />

                {/* Keep action positions stable; unavailable actions explain why. */}
                <div className="ml-auto flex items-center gap-0.5">
                  <IconButton
                    label={moveReason ?? "Move forward"}
                    active={moving}
                    activeMeans="expanded"
                    onClick={() => {
                      if (moveReason) return;
                      setUndoArming(false);
                      setCorrecting(false);
                      setMoving((v) => !v);
                    }}
                    {...unavailable(
                      moveReason,
                      moving ? "text-violet-600 dark:text-violet-300" : NEUTRAL,
                    )}
                  >
                    <ArrowRight size={ICON_SIZE} />
                  </IconButton>
                  <IconButton
                    label={undoReason ?? "Undo the last status change"}
                    active={undoArming}
                    activeMeans="expanded"
                    onClick={() => {
                      if (undoReason) return;
                      setMoving(false);
                      setCorrecting(false);
                      setUndoArming((v) => !v);
                    }}
                    {...unavailable(
                      undoReason,
                      undoArming
                        ? "text-red-600 dark:text-red-400"
                        : "text-ink-faint hover:text-red-600 dark:hover:text-red-400",
                    )}
                  >
                    <Undo2 size={ICON_SIZE} />
                  </IconButton>
                  {/* Correction repairs the record; it is not a backward move. */}
                  <IconButton
                    label="Fix incorrect status"
                    active={correcting}
                    activeMeans="expanded"
                    onClick={() => {
                      setMoving(false);
                      setUndoArming(false);
                      setCorrecting((v) => !v);
                    }}
                    className={
                      correcting
                        ? "text-amber-600 dark:text-amber-300"
                        : "text-ink-faint hover:text-amber-600 dark:hover:text-amber-300"
                    }
                  >
                    <Wrench size={ICON_SIZE} />
                  </IconButton>
                </div>
              </div>

              {/* The badge already names the stage; this line adds only duration. */}
              <MetaLine
                items={[
                  stageSince && (
                    <span key="stage">
                      <span className="text-ink-soft">{stageSpan(stageSince)}</span> in this stage
                    </span>
                  ),
                  `Added ${fmtDate(job.created_at)}`,
                ]}
              />

              {/* Reopening means returning to To apply; other targets are corrections. */}
              {moves.length === 0 && !correcting && (
                <div className="flex items-center gap-2 text-xs text-ink-muted">
                  <span>Terminal outcome.</span>
                  <button
                    title="Reopen this job — sets its status to To apply"
                    disabled={correctStatus.isPending}
                    onClick={() => correctStatus.mutate({ jobId, status: "to_apply" })}
                    className="rounded border border-line bg-surface px-2 py-1 font-medium text-emerald-700 hover:bg-surface-hover disabled:opacity-50 dark:text-emerald-300"
                  >
                    Reopen
                  </button>
                </div>
              )}

              {/* Undo confirm — a status change shouldn't fire on a stray click. */}
              {undoArming && (
                <div className="flex items-center gap-2 rounded border border-line bg-surface p-2 text-xs">
                  <span className="text-ink-soft">Undo the last status change?</span>
                  <button
                    disabled={revertStatus.isPending}
                    onClick={() => {
                      revertStatus.mutate(jobId);
                      setUndoArming(false);
                    }}
                    className="ml-auto rounded border border-line bg-surface px-2 py-1 font-medium text-ink hover:bg-surface-hover disabled:opacity-50"
                  >
                    Undo
                  </button>
                  <button
                    onClick={() => setUndoArming(false)}
                    className="rounded px-2 py-1 text-ink-muted hover:text-ink"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {moving && (
                <MovePanel
                  moves={moves}
                  onMove={(to, note) => {
                    onEvent(jobId, [{ event: to, meta: note ? { note } : undefined }]);
                    setMoving(false);
                  }}
                  onCancel={() => setMoving(false)}
                />
              )}

              {correcting && (
                <CorrectPanel
                  status={job.status}
                  busy={correctStatus.isPending}
                  onCorrect={(to, reason) => {
                    correctStatus.mutate({ jobId, status: to, reason: reason || undefined });
                    setCorrecting(false);
                  }}
                  onCancel={() => setCorrecting(false)}
                />
              )}

              {attention && (
                <AttentionPanel
                  attention={attention}
                  onAddNote={() => {
                    if (collapsedSections.has("timeline")) toggleSection("timeline");
                    setAddNoteRequest((request) => ({
                      jobId,
                      token: request?.jobId === jobId ? request.token + 1 : 1,
                    }));
                  }}
                  onMarkGhosted={() => onEvent(jobId, [{ event: "ghosted" }])}
                />
              )}
            </section>

            {/* Listings */}
            <CollapsibleSection
              title="Listings"
              count={job.listings.length}
              disclosure={disclosure("listings")}
            >
              <div className="flex flex-col gap-2">
                {job.listings.map((l) => (
                  <ListingCard
                    key={l.id}
                    listing={l}
                    jobTitle={job.title}
                    jobCompany={job.company}
                    isOnly={job.listings.length === 1}
                    onDelete={() => {
                      // The last listing dissolves the job; close only after success.
                      const lastOne = job.listings.length === 1;
                      deleteListing.mutate(
                        { listingId: l.id, jobId },
                        { onSuccess: () => lastOne && onClose() },
                      );
                    }}
                    onRelink={(targetJobId) => {
                      relinkListing.mutate({ listingId: l.id, sourceJobId: jobId, targetJobId });
                      // If this was the job's only listing the source dissolves,
                      // so follow the listing to its new home; otherwise the source
                      // survives and we stay put (more listings may need relinking).
                      if (job.listings.length === 1) onNavigate(targetJobId);
                    }}
                    onUpdate={(body) => updateListing.mutate({ listingId: l.id, jobId, body })}
                  />
                ))}
                {/* Defensive fallback for inconsistent imported data. */}
                {job.listings.length === 0 && <EmptyBlock message="No listings." />}
              </div>
            </CollapsibleSection>

            <MetaEditor job={job} disclosure={disclosure("custom-fields")} />

            <Documents
              jobId={jobId}
              documents={job.documents}
              disclosure={disclosure("documents")}
            />

            <Timeline
              key={jobId}
              jobId={jobId}
              events={job.events}
              disclosure={disclosure("timeline")}
              addNoteRequest={addNoteRequest?.jobId === jobId ? addNoteRequest.token : 0}
            />

            <section className="mt-2 flex justify-end border-t border-line pt-4">
              <InlineConfirm
                trigger="Delete job"
                confirmLabel="Delete job and all its data?"
                // Close only once the delete lands; a failed delete must leave the
                // drawer open on the job that still exists.
                onConfirm={() => deleteJob.mutate(jobId, { onSuccess: onClose })}
              />
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
