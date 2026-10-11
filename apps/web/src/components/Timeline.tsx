import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Plus, StickyNote, Trash2, X } from "lucide-react";
import type { JobEvent } from "@job-tracker/shared/api";
import { formKeys } from "../lib/forms";
import { eventLabel, isStatusSettingEvent } from "@job-tracker/shared/funnel";
import { fmtAbsolute, fmtRelative, fmtSpan, toDatetimeLocalValue } from "@job-tracker/shared/time";
import { useAddNote, useDeleteEvent, useNoteTitles, useUpdateEvent } from "../hooks";
import { EmptyBlock } from "./EmptyBlock";
import { ExpandableText } from "./ExpandableText";
import { IconButton } from "./IconButton";
import { InlineConfirm } from "./InlineConfirm";
import { MetaLine } from "./MetaLine";
import { CollapsibleSection, type SectionDisclosure } from "./CollapsibleSection";

const TITLE_LIST = "note-title-vocab";

const HELP =
  "What happened, in order. Add a note for anything dated — a call, an email, a " +
  "reply. A standing fact belongs in a custom field, a file you send in documents.";

// Keys treated as prose (the note body); `title` is rendered as the note heading.
const NOTE_KEYS = ["note", "notes", "reason"];

// Only metadata with defined presentation semantics is rendered inline. Unknown
// keys remain available through the raw disclosure without unsafe string coercion.
const NAMED_META_KEYS = new Set([
  ...NOTE_KEYS,
  "title",
  "via",
  "source",
  "legacy",
  "invalidated_at",
  "invalidated_reason",
]);

function hasUnnamedMeta(meta: Record<string, unknown> | null): boolean {
  if (!meta) return false;
  return Object.entries(meta).some(([k, v]) => !NAMED_META_KEYS.has(k) && v != null && v !== "");
}

// Explicit provenance is authoritative because job-level events have no listing ID.
function provenance(meta: Record<string, unknown> | null, captured: boolean): string {
  const source = meta?.source;
  if (typeof source === "string" && source) return source;
  const via = meta?.via;
  if (typeof via === "string" && via) return via;
  return captured ? "captured" : "manual";
}

function noteText(meta: Record<string, unknown> | null): string {
  if (!meta) return "";
  for (const k of NOTE_KEYS) {
    const v = meta[k];
    if (typeof v === "string" && v) return v;
  }
  return "";
}

function titleText(meta: Record<string, unknown> | null): string {
  return meta && typeof meta.title === "string" ? meta.title : "";
}

// Rebuild an event's meta with an edited title + body, preserving any other
// keys and dropping note synonyms so the body stays single-sourced. Empty → key
// omitted; an all-empty bag becomes null.
function buildNoteMeta(
  meta: Record<string, unknown> | null,
  title: string,
  body: string,
): Record<string, unknown> | null {
  const base: Record<string, unknown> = { ...(meta ?? {}) };
  for (const k of NOTE_KEYS) delete base[k];
  delete base.title;
  if (body.trim()) base.note = body.trim();
  if (title.trim()) base.title = title.trim();
  return Object.keys(base).length ? base : null;
}

// Events in one request share a timestamp; monotonic IDs provide the tiebreak.
function byTsAsc(a: JobEvent, b: JobEvent): number {
  return a.ts.localeCompare(b.ts) || a.id - b.id;
}

// Capture time is not lifecycle time, so birth events stay below real activity.
function byBirthLast(a: JobEvent, b: JobEvent): number {
  return Number(a.event === "created") - Number(b.event === "created");
}

// Past-tense duration labels need a value distinct from "just now".
function heldLabel(span: string): string {
  return span === "just now" ? "<1m" : span;
}

interface Props {
  jobId: string;
  events: JobEvent[];
  addNoteRequest?: number;
  disclosure?: SectionDisclosure;
}

export function Timeline({ jobId, events, addNoteRequest = 0, disclosure }: Props) {
  const updateEvent = useUpdateEvent();
  const addNote = useAddNote();
  const deleteEvent = useDeleteEvent();
  const { data: titles } = useNoteTitles();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftTs, setDraftTs] = useState("");
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const composerRef = useRef<HTMLDivElement>(null);
  const newTitleRef = useRef<HTMLInputElement>(null);

  // External requests reuse this composer, then scroll and focus after it opens.
  useEffect(() => {
    if (addNoteRequest > 0) setAdding(true);
  }, [addNoteRequest]);

  useEffect(() => {
    if (!adding || addNoteRequest === 0) return;
    composerRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    newTitleRef.current?.focus();
  }, [adding, addNoteRequest]);

  // Closed stages span to the next status event. The current stage has no past-tense
  // duration here; its ongoing duration appears in the status summary.
  const statusEvents = [...events]
    .sort(byTsAsc)
    .filter(
      (e) =>
        isStatusSettingEvent(e.event) &&
        !(e.meta?.source === "automatic" && typeof e.meta.invalidated_at === "string"),
    );
  const held = new Map<number, string>();
  statusEvents.forEach((e, i) => {
    const next = statusEvents[i + 1];
    if (next) held.set(e.id, heldLabel(fmtSpan(e.ts, next.ts)));
  });

  const ordered = [...events].sort((a, b) => byBirthLast(a, b) || -byTsAsc(a, b));

  const startEdit = (ev: JobEvent) => {
    setEditingId(ev.id);
    setDraftTitle(titleText(ev.meta));
    setDraftBody(noteText(ev.meta));
    setDraftTs(toDatetimeLocalValue(ev.ts));
  };
  const saveEdit = (ev: JobEvent) => {
    // Only note events carry a title; for other events it stays empty (a no-op).
    const title = ev.event === "note" ? draftTitle : "";
    // Correct the event's time when it changed; a local datetime-local value →
    // UTC ISO. Sent only on a real change so an untouched time is left alone.
    const nextTs = draftTs ? new Date(draftTs).toISOString() : undefined;
    const ts = nextTs && nextTs !== ev.ts ? nextTs : undefined;
    updateEvent.mutate(
      { eventId: ev.id, meta: buildNoteMeta(ev.meta, title, draftBody), ts, jobId },
      { onSuccess: () => setEditingId(null) },
    );
  };

  const closeAdd = () => {
    setAdding(false);
    setNewTitle("");
    setNewBody("");
  };
  const submitNote = () => {
    if (!newTitle.trim() && !newBody.trim()) return;
    addNote.mutate(
      {
        jobId,
        meta: {
          title: newTitle.trim() || undefined,
          note: newBody.trim() || undefined,
        },
      },
      { onSuccess: closeAdd },
    );
  };

  return (
    <CollapsibleSection
      title="Timeline"
      count={events.length}
      help={HELP}
      add={{
        noun: "note",
        open: adding,
        onToggle: () => (adding ? closeAdd() : setAdding(true)),
      }}
      disclosure={disclosure}
    >
      <datalist id={TITLE_LIST}>
        {(titles ?? []).map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      {adding && (
        <div
          ref={composerRef}
          className="mb-2 flex flex-col gap-2 rounded border border-line bg-surface p-2.5"
          onKeyDown={formKeys(submitNote, closeAdd)}
        >
          <input
            ref={newTitleRef}
            list={TITLE_LIST}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            aria-label="Note title"
            placeholder="Title (e.g. Phone screen)"
            autoFocus
            className="rounded border border-line bg-surface px-2 py-1 text-xs text-ink"
          />
          <textarea
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            aria-label="Note details (optional)"
            placeholder="Details (optional)"
            rows={2}
            className="rounded border border-line bg-surface px-2 py-1 text-xs text-ink"
          />
          <div className="flex gap-2">
            <button
              disabled={(!newTitle.trim() && !newBody.trim()) || addNote.isPending}
              onClick={submitNote}
              className="inline-flex items-center gap-1 rounded bg-violet-600 px-2 py-1 text-micro font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              <Plus size={12} /> Add note
            </button>
            <button
              onClick={closeAdd}
              className="rounded px-2 py-1 text-micro text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Also unreachable: every job is born with a `created` event. Defensive and
          undesigned, like Listings — the `+` above is the only offer worth making. */}
      {events.length === 0 ? (
        <EmptyBlock message="No events." />
      ) : (
        <ol className="flex flex-col gap-2">
          {ordered.map((ev) => {
            const isNote = ev.event === "note";
            const corrected = ev.event.startsWith("corrected:");
            const automatic = ev.event === "closed" && ev.meta?.source === "automatic";
            const invalidatedAt =
              automatic && typeof ev.meta?.invalidated_at === "string"
                ? ev.meta.invalidated_at
                : null;
            const captured = ev.listing_id != null;
            const title = titleText(ev.meta);
            const note = automatic ? "" : noteText(ev.meta);
            const showRaw = hasUnnamedMeta(ev.meta);
            const duration = held.get(ev.id);
            const isEditing = editingId === ev.id;
            return (
              <li
                key={ev.id}
                className="group flex flex-col gap-1 rounded border border-line bg-surface p-2.5 text-xs"
              >
                <div className="flex items-baseline justify-between gap-2">
                  {isNote ? (
                    // The icon signals "note" and the title stands in for the label —
                    // but an untitled note would then be a bare icon with no accessible
                    // name, so fall back to the event's own label.
                    <span className="inline-flex items-baseline gap-1.5">
                      <StickyNote size={12} className="shrink-0 self-center text-ink-faint" />
                      <span className="font-medium text-ink-soft">
                        {title || eventLabel(ev.event)}
                      </span>
                    </span>
                  ) : (
                    <span
                      className={`font-medium ${
                        corrected ? "text-amber-700 dark:text-amber-300" : "text-ink-soft"
                      }`}
                    >
                      {automatic
                        ? invalidatedAt
                          ? "Automatic closure superseded"
                          : "Closed automatically"
                        : eventLabel(ev.event)}
                    </span>
                  )}
                  {!isEditing && (
                    <span className="flex items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
                      <IconButton
                        size="sm"
                        onClick={() => startEdit(ev)}
                        label="Edit event"
                        className="text-ink-faint hover:text-ink-soft"
                      >
                        <Pencil size={12} />
                      </IconButton>
                      {isNote && (
                        <InlineConfirm
                          trigger={<Trash2 size={12} />}
                          triggerLabel="Delete note"
                          confirmLabel="Delete note?"
                          onConfirm={() => deleteEvent.mutate({ eventId: ev.id, jobId })}
                        />
                      )}
                    </span>
                  )}
                </div>

                <MetaLine
                  items={[
                    <span key="ts" title={fmtAbsolute(ev.ts)}>
                      {fmtRelative(ev.ts)}
                    </span>,
                    duration && `held ${duration}`,
                    // Provenance is only interesting for captured/automatic rows;
                    // a note is always manual, so don't state the obvious.
                    !isNote && (
                      <span key="src" title="How this event was recorded">
                        {provenance(ev.meta, captured)}
                      </span>
                    ),
                    invalidatedAt && (
                      <span key="superseded" title={fmtAbsolute(invalidatedAt)}>
                        superseded {fmtRelative(invalidatedAt)}
                      </span>
                    ),
                  ]}
                />

                {showRaw && (
                  // Preserve unknown structured metadata without guessing its meaning.
                  <details className="text-micro text-ink-muted">
                    <summary className="cursor-pointer select-none hover:text-ink-soft">
                      Raw metadata
                    </summary>
                    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded border border-line bg-canvas p-2 text-micro text-ink-muted">
                      {JSON.stringify(ev.meta, null, 2)}
                    </pre>
                  </details>
                )}

                {isEditing ? (
                  <div
                    className="flex flex-col gap-1.5"
                    onKeyDown={formKeys(
                      () => saveEdit(ev),
                      () => setEditingId(null),
                    )}
                  >
                    <label className="flex flex-col gap-0.5 text-micro text-ink-muted">
                      Event time
                      <input
                        type="datetime-local"
                        value={draftTs}
                        onChange={(e) => setDraftTs(e.target.value)}
                        className="rounded border border-line bg-surface px-2 py-1 text-xs text-ink"
                      />
                    </label>
                    {isNote && (
                      <input
                        list={TITLE_LIST}
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        aria-label="Note title"
                        placeholder="Title"
                        className="rounded border border-line bg-surface px-2 py-1 text-xs text-ink"
                      />
                    )}
                    <textarea
                      value={draftBody}
                      onChange={(e) => setDraftBody(e.target.value)}
                      aria-label={isNote ? "Note details (optional)" : "Note on this event"}
                      placeholder={isNote ? "Details (optional)" : "Add a note to this event…"}
                      rows={2}
                      autoFocus
                      className="rounded border border-line bg-surface px-2 py-1 text-xs text-ink"
                    />
                    <div className="flex gap-2">
                      <button
                        disabled={updateEvent.isPending}
                        onClick={() => saveEdit(ev)}
                        className="inline-flex items-center gap-1 rounded bg-violet-600 px-2 py-1 text-micro font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                      >
                        <Check size={12} /> Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-micro text-ink-muted hover:text-ink"
                      >
                        <X size={12} /> Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  note && <ExpandableText text={note} className="text-prose text-ink-soft" />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </CollapsibleSection>
  );
}
