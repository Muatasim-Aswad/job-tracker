import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import type { DocumentCreate, DocumentUpdate, JobDocument } from "@job-tracker/shared/api";
import { formKeys } from "../lib/forms";
import { useAddDocument, useDeleteDocument, useUpdateDocument } from "../hooks";
import { fmtDate } from "@job-tracker/shared/time";
import { ExpandableText } from "./ExpandableText";
import { IconButton } from "./IconButton";
import { InlineConfirm } from "./InlineConfirm";
import { MetaLine } from "./MetaLine";
import { CollapsibleSection, type SectionDisclosure } from "./CollapsibleSection";

const DOC_TYPES = ["cover_letter", "motivation_letter", "cv", "other"];

const DOC_TYPE_LABEL: Record<string, string> = {
  cover_letter: "Cover letter",
  motivation_letter: "Motivation letter",
  cv: "CV",
  other: "Other",
};

const docLabel = (type: string) => DOC_TYPE_LABEL[type] ?? type;

// Only what a document is. The rest of the three-way rule — dated event vs. standing
// fact — lives on Timeline, the section that owns that choice.
const HELP = "Deliverables you send: CV, cover letter, motivation letter.";

// The request state a doc can carry; '' is the wire `null` (unspecified).
const REQUESTED = [
  { value: "", label: "not specified" },
  { value: "required", label: "required" },
  { value: "optional", label: "optional" },
];

const inputCls = "rounded border border-line bg-surface px-2 py-1 text-xs text-ink";

interface Draft {
  type: string;
  requested: string;
  provided: boolean;
  content: string;
}

function toDraft(d: JobDocument): Draft {
  return {
    type: d.type,
    requested: d.requested ?? "",
    provided: d.provided,
    content: d.content ?? "",
  };
}

const emptyDraft: Draft = { type: "cover_letter", requested: "", provided: false, content: "" };

// The shared field row used by both the edit form and the add form.
function DraftFields({
  draft,
  onChange,
}: {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Document type"
          value={draft.type}
          onChange={(e) => onChange({ type: e.target.value })}
          className={inputCls}
        >
          {DOC_TYPES.map((t) => (
            <option key={t} value={t}>
              {docLabel(t)}
            </option>
          ))}
        </select>
        <select
          aria-label="Requested by the employer"
          value={draft.requested}
          onChange={(e) => onChange({ requested: e.target.value })}
          className={inputCls}
        >
          {REQUESTED.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-ink-soft">
          <input
            type="checkbox"
            checked={draft.provided}
            onChange={(e) => onChange({ provided: e.target.checked })}
          />
          provided
        </label>
      </div>
      <textarea
        value={draft.content}
        onChange={(e) => onChange({ content: e.target.value })}
        aria-label="Document content or notes (optional)"
        placeholder="Content / notes (optional)"
        rows={3}
        className={inputCls}
      />
    </>
  );
}

function DocumentCard({ jobId, doc }: { jobId: string; doc: JobDocument }) {
  const updateDoc = useUpdateDocument();
  const deleteDoc = useDeleteDocument();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(doc));

  const content = doc.content?.trim() ?? "";

  const save = () => {
    // The draft is DOM form state (plain strings), but the <select> options are
    // constrained to the valid enum values, so assert that at the API edge.
    const body: DocumentUpdate = {
      type: draft.type as DocumentUpdate["type"],
      requested: (draft.requested || null) as DocumentUpdate["requested"],
      provided: draft.provided,
      content: draft.content || null,
    };
    updateDoc.mutate({ documentId: doc.id, body, jobId }, { onSuccess: () => setEditing(false) });
  };

  if (editing) {
    return (
      <div
        className="flex flex-col gap-2 rounded border border-line bg-surface p-3"
        onKeyDown={formKeys(save, () => {
          setDraft(toDraft(doc));
          setEditing(false);
        })}
      >
        <DraftFields draft={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
        <div className="flex gap-2">
          <button
            disabled={updateDoc.isPending}
            onClick={save}
            className="inline-flex items-center gap-1 rounded bg-violet-600 px-2 py-1 text-micro font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            <Check size={12} /> Save
          </button>
          <button
            onClick={() => {
              setDraft(toDraft(doc));
              setEditing(false);
            }}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-micro text-ink-muted hover:text-ink"
          >
            <X size={12} /> Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col gap-1 rounded border border-line bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink">{docLabel(doc.type)}</span>
        <span className="flex items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
          <IconButton
            size="sm"
            onClick={() => setEditing(true)}
            label="Edit document"
            className="text-ink-faint hover:text-ink-soft"
          >
            <Pencil size={13} />
          </IconButton>
          <InlineConfirm
            trigger={<Trash2 size={13} />}
            triggerLabel="Delete document"
            confirmLabel="Delete document?"
            onConfirm={() => deleteDoc.mutate({ documentId: doc.id, jobId })}
          />
        </span>
      </div>
      <MetaLine
        items={[
          doc.requested,
          doc.provided && (
            <span
              key="provided"
              className="inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400"
            >
              <Check size={11} /> provided
            </span>
          ),
          `added ${fmtDate(doc.created_at)}`,
        ]}
      />
      {content && (
        <ExpandableText text={content} className="text-prose leading-relaxed text-ink-soft" />
      )}
    </div>
  );
}

export function Documents({
  jobId,
  documents,
  disclosure,
}: {
  jobId: string;
  documents: JobDocument[];
  disclosure?: SectionDisclosure;
}) {
  const addDoc = useAddDocument();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  const close = () => {
    setAdding(false);
    setDraft(emptyDraft);
  };

  const add = () => {
    addDoc.mutate(
      {
        jobId,
        body: {
          type: draft.type as DocumentCreate["type"],
          requested: (draft.requested || null) as DocumentCreate["requested"],
          provided: draft.provided,
          content: draft.content || null,
        },
      },
      { onSuccess: close },
    );
  };

  return (
    <CollapsibleSection
      title="Documents"
      count={documents.length}
      help={HELP}
      add={{
        noun: "document",
        open: adding,
        onToggle: () => (adding ? close() : setAdding(true)),
      }}
      disclosure={disclosure}
    >
      <div className="flex flex-col gap-2">
        {adding && (
          <div
            className="flex flex-col gap-2 rounded border border-line bg-surface p-3"
            onKeyDown={formKeys(add, close)}
          >
            <DraftFields
              draft={draft}
              onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            />
            <div className="flex gap-2">
              <button
                disabled={addDoc.isPending}
                onClick={add}
                className="inline-flex items-center gap-1 rounded bg-violet-600 px-2 py-1 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                <Plus size={13} /> Add
              </button>
              <button
                onClick={close}
                className="rounded px-2 py-1 text-xs text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {documents.map((d) => (
          <DocumentCard key={d.id} jobId={jobId} doc={d} />
        ))}

        {/* No empty state. `SectionHeader` already carries the count — a literal
            `(0)` — the `?` explaining what documents are for, and the `+` that adds
            one. A dashed "No documents yet. + Add document" box below it said all
            three a third time, and made an empty section taller than a full one
            with a single card. The header IS the empty state. */}
      </div>
    </CollapsibleSection>
  );
}
