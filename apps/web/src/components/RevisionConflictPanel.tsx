import { useState } from "react";
import { FormFillApiError } from "../api/client";

interface Props {
  error: unknown;
  draft?: string;
  onReviewCurrent: () => void | Promise<void>;
  onDiscard: () => void;
}

function publicSummary(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicSummary);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !["value", "raw_question", "raw_help", "raw_section"].includes(key))
      .map(([key, nested]) => [key, publicSummary(nested)]),
  );
}

function isRevisionConflict(error: unknown): error is FormFillApiError {
  return error instanceof FormFillApiError && error.status === 409;
}

export function RevisionConflictPanel({ error, draft, onReviewCurrent, onDiscard }: Props) {
  const [copied, setCopied] = useState(false);
  if (!isRevisionConflict(error)) return null;

  const current = error.current ? JSON.stringify(publicSummary(error.current), null, 2) : null;

  return (
    <section
      role="alert"
      aria-labelledby="revision-conflict-title"
      className="space-y-3 rounded-lg border border-amber-500/50 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
    >
      <div>
        <h3 id="revision-conflict-title" className="font-semibold">
          This changed while you were looking at it.
        </h3>
        <p>Your change was not applied. Your draft is still here.</p>
      </div>
      {current && (
        <details>
          <summary className="cursor-pointer font-medium">Current server summary</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface p-2 text-xs text-ink">
            {current}
          </pre>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void onReviewCurrent()}
          className="rounded bg-amber-700 px-3 py-1.5 font-medium text-white hover:bg-amber-800"
        >
          Review current version
        </button>
        {draft != null && (
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(draft);
              setCopied(true);
            }}
            className="rounded border border-amber-700 px-3 py-1.5 font-medium"
          >
            {copied ? "Copied" : "Copy my changes"}
          </button>
        )}
        <button type="button" onClick={onDiscard} className="rounded px-3 py-1.5 font-medium">
          Discard mine
        </button>
      </div>
    </section>
  );
}
