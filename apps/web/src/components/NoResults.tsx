interface Props {
  query: string;
  showStarred: boolean;
  showAttention: boolean;
  hideHidden: boolean;
  hideBlocked: boolean;
  easyApplyOnly: boolean;
  onClear: () => void;
}

// Replaces the board when the current filters narrow the view to nothing —
// distinct from an empty account (no jobs at all), which App never routes here.
export function NoResults({
  query,
  showStarred,
  showAttention,
  hideHidden,
  hideBlocked,
  easyApplyOnly,
  onClear,
}: Props) {
  const q = query.trim();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-ink-muted">
      <p>
        {q && showStarred && showAttention
          ? `No jobs match “${q}” among starred jobs needing attention.`
          : q && showAttention
            ? `No jobs needing attention match “${q}”.`
            : q && showStarred
              ? `No jobs match “${q}” among starred.`
              : q
                ? `No jobs match “${q}”.`
                : showStarred && showAttention
                  ? "No starred jobs need attention."
                  : showAttention
                    ? "No jobs need attention."
                    : showStarred
                      ? "No starred jobs match."
                      : easyApplyOnly
                        ? "No Easy Apply jobs match."
                        : hideBlocked
                          ? "No jobs from unblocked companies match."
                          : hideHidden
                            ? "No non-hidden jobs match."
                            : "No jobs match."}
      </p>
      <button
        type="button"
        onClick={onClear}
        className="rounded-lg border border-line bg-surface px-3 py-1.5 text-prose font-semibold text-ink transition-colors hover:border-line-strong hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
      >
        Clear filters
      </button>
    </div>
  );
}
