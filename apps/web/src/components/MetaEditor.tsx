import { useId, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import type { JobDetail, MetaVocabulary } from "@job-tracker/shared/api";
import { formKeys } from "../lib/forms";
import { useMetaVocabulary, useUpdateJob } from "../hooks";
import { ExpandableText } from "./ExpandableText";
import { IconButton } from "./IconButton";
import { InlineConfirm } from "./InlineConfirm";
import { CollapsibleSection, type SectionDisclosure } from "./CollapsibleSection";

// Edit the job's free-form metadata as individual custom fields. Writes replace
// the complete bag, so every update must preserve unrelated entries.

const KEY_LIST = "meta-key-vocab";

const HELP =
  "Your own fields on this job: recruiter, salary expectation, referral — anything " +
  "the tracker has no place for.";

// Server-owned metadata must survive user edits and never appear as a custom field.
const SYSTEM_KEYS = new Set(["false_matches"]);

// Seed suggestions disappear as the user's own vocabulary fills the row.
const SEED_KEYS = ["recruiter", "salary expectation", "referral", "location"];

// Stored value → editable/displayable string.
function toDisplay(v: unknown): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v) ?? "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "bigint") {
    return v.toString();
  }
  return "";
}

// Edited string → typed JSON value, conservatively: exact booleans and numbers
// that round-trip cleanly (so "0612…" stays a string, not a lossy number).
function coerce(s: string): unknown {
  const t = s.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (t !== "" && String(Number(t)) === t) return Number(t);
  return s;
}

// The key/value input pair, shared by the add form and each card's edit mode.
function KeyValueFields({
  fieldKey,
  value,
  onKey,
  onValue,
  vocab,
}: {
  fieldKey: string;
  value: string;
  onKey: (v: string) => void;
  onValue: (v: string) => void;
  vocab: MetaVocabulary | undefined;
}) {
  const valList = useId();
  const values = vocab?.keys.find((k) => k.key === fieldKey.trim())?.values ?? [];
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
      <input
        list={KEY_LIST}
        value={fieldKey}
        onChange={(e) => onKey(e.target.value)}
        aria-label="Field name"
        placeholder="field"
        className="w-full min-w-0 rounded border border-line bg-surface px-2 py-1 text-xs text-ink sm:w-32"
      />
      <input
        list={valList}
        value={value}
        onChange={(e) => onValue(e.target.value)}
        aria-label="Field value"
        placeholder="value"
        className="w-full min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-xs text-ink"
      />
      <datalist id={valList}>
        {values.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
    </div>
  );
}

function MetaCard({
  job,
  name,
  value,
  vocab,
}: {
  job: JobDetail;
  name: string;
  value: unknown;
  vocab: MetaVocabulary | undefined;
}) {
  const updateJob = useUpdateJob();
  const [editing, setEditing] = useState(false);
  const [fieldKey, setFieldKey] = useState(name);
  const [fieldValue, setFieldValue] = useState(toDisplay(value));

  const save = () => {
    // Prevent a user field from overwriting server-owned metadata.
    if (SYSTEM_KEYS.has(fieldKey.trim())) return;
    // Rebuild from the complete bag so hidden server-owned keys survive.
    const entries = Object.entries(job.meta)
      .map(([k, v]): [string, unknown] =>
        k === name ? [fieldKey.trim(), coerce(fieldValue)] : [k, v],
      )
      .filter(([k]) => k);
    updateJob.mutate(
      { jobId: job.id, body: { meta: Object.fromEntries(entries) } },
      { onSuccess: () => setEditing(false) },
    );
  };

  const remove = () => {
    const meta = { ...job.meta };
    delete meta[name];
    updateJob.mutate({ jobId: job.id, body: { meta } });
  };

  const cancel = () => {
    setFieldKey(name);
    setFieldValue(toDisplay(value));
    setEditing(false);
  };

  if (editing) {
    return (
      <div
        className="flex flex-col gap-2 rounded border border-line bg-surface p-2.5"
        onKeyDown={formKeys(save, cancel)}
      >
        <KeyValueFields
          fieldKey={fieldKey}
          value={fieldValue}
          onKey={setFieldKey}
          onValue={setFieldValue}
          vocab={vocab}
        />
        <div className="flex gap-2">
          <button
            disabled={updateJob.isPending || SYSTEM_KEYS.has(fieldKey.trim())}
            onClick={save}
            className="inline-flex items-center gap-1 rounded bg-violet-600 px-2 py-1 text-micro font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            <Check size={12} /> Save
          </button>
          <button
            onClick={cancel}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-micro text-ink-muted hover:text-ink"
          >
            <X size={12} /> Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col gap-0.5 rounded border border-line bg-surface p-2.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-ink-muted">{name}</span>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
          <IconButton
            size="sm"
            onClick={() => setEditing(true)}
            label={`Edit ${name}`}
            className="text-ink-faint hover:text-ink-soft"
          >
            <Pencil size={13} />
          </IconButton>
          <InlineConfirm
            trigger={<Trash2 size={13} />}
            triggerLabel={`Delete ${name}`}
            confirmLabel={`Delete ${name}?`}
            onConfirm={remove}
          />
        </div>
      </div>
      <ExpandableText
        text={toDisplay(value)}
        className="text-prose leading-relaxed text-ink-soft"
      />
    </div>
  );
}

export function MetaEditor({
  job,
  disclosure,
}: {
  job: JobDetail;
  disclosure?: SectionDisclosure;
}) {
  const updateJob = useUpdateJob();
  const { data: vocab } = useMetaVocabulary("jobs");
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  // Hide server-owned keys without dropping them from subsequent writes.
  const entries = Object.entries(job.meta).filter(([k]) => !SYSTEM_KEYS.has(k));
  const present = new Set(Object.keys(job.meta));

  // Prefer the user's vocabulary and use seeds only to fill the row.
  const fromVocab = (vocab?.keys ?? []).filter((k) => !present.has(k.key)).map((k) => k.key);
  const suggestions = [...fromVocab, ...SEED_KEYS.filter((k) => !present.has(k))]
    .filter((k, i, all) => all.indexOf(k) === i)
    .slice(0, 6)
    .map((key) => ({ key, uses: vocab?.keys.find((v) => v.key === key)?.uses }));

  const close = () => {
    setAdding(false);
    setNewKey("");
    setNewValue("");
  };

  const add = () => {
    const key = newKey.trim();
    // Apply the same reserved-key guard as the edit path.
    if (!key || SYSTEM_KEYS.has(key)) return;
    updateJob.mutate(
      { jobId: job.id, body: { meta: { ...job.meta, [key]: coerce(newValue) } } },
      { onSuccess: close },
    );
  };

  return (
    <CollapsibleSection
      title="Custom fields"
      count={entries.length}
      help={HELP}
      add={{
        noun: "custom field",
        open: adding,
        onToggle: () => (adding ? close() : setAdding(true)),
      }}
      disclosure={disclosure}
    >
      {/* Shared key vocabulary — native datalist gives substring matching for free. */}
      <datalist id={KEY_LIST}>
        {(vocab?.keys ?? []).map((k) => (
          <option key={k.key} value={k.key} />
        ))}
      </datalist>

      <div className="flex flex-col gap-2">
        {adding && (
          <div
            className="flex flex-col gap-2 rounded border border-line bg-surface p-2.5"
            onKeyDown={formKeys(add, close)}
          >
            <KeyValueFields
              fieldKey={newKey}
              value={newValue}
              onKey={setNewKey}
              onValue={setNewValue}
              vocab={vocab}
            />
            {suggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => setNewKey(s.key)}
                    title={
                      s.uses === undefined
                        ? "suggested field"
                        : `used on ${s.uses} ${s.uses === 1 ? "job" : "jobs"}`
                    }
                    className="rounded-full border border-line px-2 py-0.5 text-micro text-ink-muted hover:bg-surface-hover"
                  >
                    + {s.key}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button
                disabled={!newKey.trim() || SYSTEM_KEYS.has(newKey.trim()) || updateJob.isPending}
                onClick={add}
                className="inline-flex items-center gap-1 rounded bg-violet-600 px-2 py-1 text-micro font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                <Plus size={12} /> Add
              </button>
              <button
                onClick={close}
                className="rounded px-2 py-1 text-micro text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {entries.map(([k, v]) => (
          <MetaCard key={k} job={job} name={k} value={v} vocab={vocab} />
        ))}
      </div>
    </CollapsibleSection>
  );
}
