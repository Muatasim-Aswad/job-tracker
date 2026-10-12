import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { JobFunnel } from "@job-tracker/shared/funnel";
import { localDay } from "@job-tracker/shared/time";
import { ICON } from "../icons.js";
import { SERVER_URL } from "../config.js";
import { shortDate, todayDay } from "./eventDate.js";
import { getJob, patchEventMeta, postEvents } from "./api.js";
import type { PopupEvent, PopupJob } from "./types";
import { ACTION_BUTTON, BUTTON, FOCUS, ICON as ICON_CLASS, INPUT, PRIMARY_BUTTON } from "./ui";

// Job details, status transitions, status comments, and standalone notes. The
// imperative handle exposes the popup's keyboard actions.

// Verbs that represent a funnel status transition (vs. note/flag rows), so a
// "status comment" can be pinned to the right event.
const STATUS_VERBS = new Set<string>([
  ...JobFunnel.ACTIVE_STATUSES,
  ...JobFunnel.TERMINAL_STATUSES,
]);

// The job's most recent status-transition event (largest id = latest), or undefined
// when it has none yet (a fresh `new` job).
function lastStatusEvent(events: PopupEvent[]): PopupEvent | undefined {
  return events
    .filter((e) => STATUS_VERBS.has(e.event))
    .sort((a, b) => a.id - b.id)
    .pop();
}

// Allow all server-legal forward moves. seen is automatic; skipped is pre-application only.
function statusChoices(job: PopupJob): string[] {
  return JobFunnel.forwardMoves(job.status).filter(
    (s) => s !== "seen" && !(s === "skipped" && JobFunnel.APPLIED.has(job.status)),
  );
}

export interface DetailHandle {
  // Submit whichever sub-form is open (Ctrl/⌘+Enter). No-op when none is open.
  submitOpenForm: () => void;
  // Focus + open the status dropdown (the `s` key). No-op on a terminal status,
  // where the dropdown isn't rendered.
  openStatus: () => void;
  // Toggle the status-comment form (the `c` key).
  toggleComment: () => void;
  // Toggle the free-standing note form (the `n` key).
  toggleNote: () => void;
}

interface DetailProps {
  job: PopupJob;
  eventDate: string;
  setEventDate: (v: string) => void;
  suggestedTs: string | null;
  chosenTs: () => string | undefined;
  onBack: () => void;
  // A status move projected a new status — sync the detail header + the results row.
  onStatusChange: (updated: PopupJob) => void;
  showOk: () => void;
  showError: (text: string) => void;
}

export const Detail = forwardRef<DetailHandle, DetailProps>(function Detail(
  {
    job,
    eventDate,
    setEventDate,
    suggestedTs,
    chosenTs,
    onBack,
    onStatusChange,
    showOk,
    showError,
  },
  ref,
) {
  const [statusApplying, setStatusApplying] = useState(false);

  // The status "as of <date>" chip's inline picker, collapsed by default. The chip
  // only shows when the date isn't today, so this stays closed on the common path.
  const [dateOpen, setDateOpen] = useState(false);

  const [commentOpen, setCommentOpen] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  // The event to patch, resolved when the form opens so prefill and save agree on the
  // same row. Null when no status event exists yet.
  const [commentTarget, setCommentTarget] = useState<PopupEvent | null>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  const [noteOpen, setNoteOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const statusRef = useRef<HTMLSelectElement>(null);

  const choices = statusChoices(job);
  const pl = job.primary_listing;

  // ── Status move ──────────────────────────────────────────────────────────────
  // A valid selection applies immediately; comments remain optional.
  async function applyStatus(target: string) {
    if (!target || statusApplying || !JobFunnel.isForwardMove(job.status, target)) return;
    setStatusApplying(true);
    try {
      const state = await postEvents(job.id, [{ event: target }], chosenTs());
      // The comment button is now bound to this move, so reset the welded sub-forms
      // and reflect the server's projected status.
      setCommentOpen(false);
      setCommentTarget(null);
      setCommentBody("");
      onStatusChange({ ...job, status: state.status });
      showOk();
    } catch {
      showError("Couldn't update status — is the tracker running?");
    } finally {
      setStatusApplying(false);
    }
  }

  // ── Status comment ─────────────────────────────────────────────────────────────
  // Attach status comments to the latest transition, including terminal states,
  // by patching meta.note. Opening loads that event and its existing comment.
  async function toggleComment() {
    if (commentOpen) {
      setCommentOpen(false);
      return;
    }
    setCommentOpen(true);
    try {
      const full = await getJob(job.id);
      const target = lastStatusEvent(full.events || []) ?? null;
      setCommentTarget(target);
      const existing = target?.meta?.note;
      // Show the previous comment to edit, without clobbering text already typed.
      if (typeof existing === "string" && existing) {
        setCommentBody((b) => (b ? b : existing));
      }
    } catch {
      /* best effort — leave the box empty and re-resolve on save */
    }
  }

  async function saveComment() {
    const text = commentBody.trim();
    if (!text || commentSaving) return;
    setCommentSaving(true);
    try {
      // Reuse the event resolved on open, re-fetching only if that failed. With no
      // status event at all, fall back to a standalone note.
      let ev = commentTarget;
      if (!ev) ev = lastStatusEvent((await getJob(job.id)).events || []) ?? null;
      if (ev) await patchEventMeta(ev.id, { ...(ev.meta || {}), note: text });
      else await postEvents(job.id, [{ event: "note", meta: { note: text } }]);
      showOk();
      setCommentOpen(false);
      setCommentBody("");
      setCommentTarget(null);
    } catch {
      showError("Couldn't save comment — is the tracker running?");
    } finally {
      setCommentSaving(false);
    }
  }

  // ── Note ───────────────────────────────────────────────────────────────────────
  // Notes record activity at server time without changing status.
  // Status comments belong on transitions; backdate notes in the dashboard.
  async function saveNote() {
    const meta: { title?: string; note?: string } = {};
    if (noteTitle.trim()) meta.title = noteTitle.trim();
    if (noteBody.trim()) meta.note = noteBody.trim();
    if ((!meta.note && !meta.title) || noteSaving) return;
    setNoteSaving(true);
    try {
      await postEvents(job.id, [{ event: "note", meta }]);
      showOk();
      setNoteOpen(false);
      setNoteTitle("");
      setNoteBody("");
    } catch {
      showError("Couldn't add note — is the tracker running?");
    } finally {
      setNoteSaving(false);
    }
  }

  // Focus the just-opened form's text field, mirroring the imperative popup.
  useEffect(() => {
    if (commentOpen) commentRef.current?.focus();
  }, [commentOpen]);
  useEffect(() => {
    if (noteOpen) noteRef.current?.focus();
  }, [noteOpen]);

  useImperativeHandle(ref, () => ({
    submitOpenForm() {
      if (commentOpen) void saveComment();
      else if (noteOpen) void saveNote();
    },
    openStatus() {
      const el = statusRef.current;
      if (!el) return; // terminal status — no dropdown to open
      el.focus();
      // showPicker drops the list open (Chrome 121+); the keydown that got us here
      // is the required user gesture. Focus alone is the fallback if it's unavailable.
      try {
        el.showPicker();
      } catch {
        /* older Chrome / no transient activation — the select is at least focused */
      }
    },
    toggleComment() {
      void toggleComment();
    },
    toggleNote() {
      setNoteOpen((o) => !o);
    },
  }));

  const openApp = () => {
    if (!pl) return;
    // Dashboard deep links use the bare server origin and the listing natural key.
    const qs = new URLSearchParams({ platform: pl.platform, platform_id: pl.platform_id });
    void chrome.tabs.create({ url: `${SERVER_URL}/?${qs}` });
  };
  const openListing = () => {
    if (pl?.url) void chrome.tabs.create({ url: pl.url });
  };

  const suggestedDay = suggestedTs ? localDay(suggestedTs) : null;
  // Whether the next status move records at now. Drives the date chip's two faces: a
  // quiet calendar icon (nothing to say) vs. an "as of <date>" label when back-dated.
  const datedToday = eventDate === todayDay();

  return (
    <div id="detail" className="mt-2">
      <button
        className={
          "-ml-0.5 mb-2.5 inline-flex items-center gap-1 border-0 bg-transparent p-0.5 text-[13px] leading-none text-popup-faint hover:text-popup-fg " +
          FOCUS
        }
        title="Back to results"
        onClick={onBack}
      >
        <span className="text-base" aria-hidden="true">
          ←
        </span>
        Back
      </button>

      {/* Link titles to the dashboard only with a listing key, and companies only with a captured URL. */}
      <div
        className={
          pl
            ? "cursor-pointer text-sm leading-snug font-semibold text-popup-accent hover:underline"
            : "text-sm leading-snug font-semibold text-popup-fg"
        }
        title={pl ? "Open in the tracker app" : undefined}
        onClick={pl ? openApp : undefined}
      >
        {job.title || "(untitled)"}
      </div>
      <div className="mt-0.5 text-xs text-popup-soft">
        <span
          className={pl?.url ? "cursor-pointer text-popup-accent hover:underline" : undefined}
          title={pl?.url ? "Open the job listing" : undefined}
          onClick={pl?.url ? openListing : undefined}
        >
          {job.company || "—"}
        </span>
        {" · "}
        {/* A terminal status offers no forward move: the dropdown is dropped and the
            "change it in the app" explanation rides as a tooltip on the status word. */}
        <span
          className={
            choices.length ? undefined : "cursor-help border-b border-dotted border-popup-faint"
          }
          title={choices.length ? undefined : "Terminal status — change it in the app."}
        >
          {JobFunnel.labelOf(job.status)}
        </span>
      </div>

      {/* Selecting a forward status applies immediately. The date picker affects only
          that transition; comments remain available on terminal states. */}
      <div className="mt-3">
        {choices.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              ref={statusRef}
              className={
                "min-w-0 flex-1 cursor-pointer rounded-md border border-popup-border bg-popup-surface px-2 py-1.5 text-[13px] text-popup-fg " +
                FOCUS
              }
              value=""
              disabled={statusApplying}
              onChange={(e) => void applyStatus(e.target.value)}
            >
              <option value="" disabled>
                Advance status…
              </option>
              {choices.map((s) => (
                <option key={s} value={s}>
                  {JobFunnel.labelOf(s)}
                </option>
              ))}
            </select>
            <div className="relative shrink-0 whitespace-nowrap">
              <button
                className={
                  datedToday
                    ? "inline-flex items-center p-0.5 text-xs text-popup-soft hover:text-popup-accent " +
                      FOCUS
                    : "inline-flex items-center border-0 bg-transparent p-0 text-xs text-popup-soft hover:text-popup-accent " +
                      FOCUS
                }
                title={
                  datedToday
                    ? "Back-date this status change"
                    : "When this status change happened — click to adjust"
                }
                aria-label="Set the date this status change happened"
                onClick={() => setDateOpen((o) => !o)}
              >
                {datedToday ? (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <path d="M16 2v4M8 2v4M3 10h18" />
                  </svg>
                ) : (
                  `as of ${shortDate(eventDate)}`
                )}
              </button>
              {dateOpen && (
                <div className="absolute top-[calc(100%+4px)] right-0 z-10 flex items-center gap-1.5 rounded-lg border border-popup-popover bg-popup-surface p-1.5 shadow-[0_2px_8px_var(--shadow)]">
                  <input
                    type="date"
                    className={INPUT + " w-auto px-1.5 py-0.5 text-xs"}
                    value={eventDate}
                    title={
                      suggestedDay && eventDate === suggestedDay
                        ? "Suggested from the open email — the day it arrived"
                        : undefined
                    }
                    onChange={(e) => {
                      setEventDate(e.target.value);
                      setDateOpen(false);
                    }}
                  />
                  <button
                    className={
                      "border-0 bg-transparent p-0 text-xs text-popup-accent hover:underline " +
                      FOCUS
                    }
                    title="Date it today instead"
                    onClick={() => {
                      setEventDate(todayDay());
                      setDateOpen(false);
                    }}
                  >
                    now
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className={choices.length ? "mt-2" : undefined}>
          <button
            className={ACTION_BUTTON + " " + FOCUS}
            title="Add or edit a comment on the current status — it stays pinned to this status change"
            onClick={() => void toggleComment()}
          >
            <span className={ICON_CLASS} dangerouslySetInnerHTML={{ __html: ICON.pencil }} />
            Comment
          </button>
          {commentOpen && (
            <div>
              <textarea
                ref={commentRef}
                className={INPUT + " mt-1.5 resize-y"}
                rows={2}
                placeholder="Comment on the current status"
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
              />
              <div className="mt-1.5 flex gap-1.5 [&>button]:flex-1">
                <button
                  className={PRIMARY_BUTTON + " " + FOCUS}
                  disabled={commentSaving}
                  onClick={() => void saveComment()}
                >
                  Save comment
                </button>
                <button
                  className={BUTTON + " " + FOCUS}
                  onClick={() => {
                    setCommentOpen(false);
                    setCommentBody("");
                    setCommentTarget(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3">
        <button
          className={ACTION_BUTTON + " " + FOCUS}
          title="Add a standalone note — activity that doesn't change the job's status"
          onClick={() => setNoteOpen((o) => !o)}
        >
          <span className={ICON_CLASS} dangerouslySetInnerHTML={{ __html: ICON.stickyNote }} />
          Note
        </button>
        {noteOpen && (
          <div>
            <input
              className={INPUT + " mt-1.5"}
              placeholder="Title (optional)"
              list="note-titles"
              autoComplete="off"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
            />
            <textarea
              ref={noteRef}
              className={INPUT + " mt-1.5 resize-y"}
              rows={3}
              placeholder="Note"
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
            />
            <div className="mt-1.5 flex gap-1.5 [&>button]:flex-1">
              <button
                className={PRIMARY_BUTTON + " " + FOCUS}
                disabled={noteSaving}
                onClick={() => void saveNote()}
              >
                Add note
              </button>
              <button
                className={BUTTON + " " + FOCUS}
                onClick={() => {
                  setNoteOpen(false);
                  setNoteTitle("");
                  setNoteBody("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
