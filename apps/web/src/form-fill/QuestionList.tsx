import { useMemo, useState } from "react";
import { useFormFillQuestions } from "../hooks";
import { formatDate, type QuestionSummary } from "./model";

interface Props {
  onOpen: (questionId: string) => void;
}

export function QuestionList({ onOpen }: Props) {
  const [mappingStatus, setMappingStatus] = useState<
    "" | "active" | "disabled" | "retired" | "none"
  >("");
  const [sort, setSort] = useState<"last_seen" | "seen_count">("last_seen");
  const filters = useMemo(
    () => ({
      review_state: "open" as const,
      mapping_status: mappingStatus || undefined,
      sort,
      limit: 30,
    }),
    [mappingStatus, sort],
  );
  const query = useFormFillQuestions(filters);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section aria-labelledby="questions-title" className="space-y-4">
      <div>
        <h3 id="questions-title" className="text-lg font-semibold text-ink">
          Unresolved Questions
        </h3>
        <p className="text-sm text-ink-muted">
          Exact field variants that still need a safe decision.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm text-ink">
          Match state{" "}
          <select
            value={mappingStatus}
            onChange={(event) => setMappingStatus(event.target.value as typeof mappingStatus)}
            className="ml-2 rounded border border-line bg-surface px-2 py-1.5"
          >
            <option value="">All</option>
            <option value="none">No Match</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="retired">Retired</option>
          </select>
        </label>
        <label className="text-sm text-ink">
          Order{" "}
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as typeof sort)}
            className="ml-2 rounded border border-line bg-surface px-2 py-1.5"
          >
            <option value="last_seen">Most recent</option>
            <option value="seen_count">Most seen</option>
          </select>
        </label>
      </div>
      {query.isLoading ? (
        <p role="status" className="text-sm text-ink-muted">
          Loading Questions…
        </p>
      ) : query.isError ? (
        <div role="alert" className="space-y-2 text-sm text-red-700 dark:text-red-300">
          <p>Couldn’t load unresolved Questions.</p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="font-medium underline"
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line p-8 text-center">
          <p className="font-medium text-ink">
            {mappingStatus ? "No Questions match this filter." : "No Questions need review."}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            Questions seen by the extension will appear here when they need a decision.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {items.map((question: QuestionSummary) => (
            <li key={question.id}>
              <button
                type="button"
                onClick={() => onOpen(question.id)}
                className="grid w-full gap-1 p-4 text-left hover:bg-surface-hover sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <span>
                  <span className="block font-medium text-ink">{question.raw_question}</span>
                  <span className="text-xs text-ink-muted">
                    {question.site_scope} · {question.control_kind} · seen {question.seen_count}{" "}
                    times
                  </span>
                </span>
                <span className="text-xs text-ink-muted">
                  {question.capture_conflict ? "Remembered-value conflict · " : ""}
                  {question.mapping ? `Match ${question.mapping.status} · ` : "No Match · "}
                  {formatDate(question.last_seen_at)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <button
          type="button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
          className="rounded border border-line bg-surface px-3 py-2 text-sm font-medium text-ink disabled:opacity-50"
        >
          {query.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}
