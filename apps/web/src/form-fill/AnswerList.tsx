import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useFormFillAnswers } from "../hooks";
import {
  POLICY_LABEL,
  VALUE_KIND_LABEL,
  formatDate,
  type AnswerListItem,
  type AnswerValueKind,
} from "./model";

interface Props {
  onOpen: (answerId: string) => void;
  onCreate: () => void;
}

export function AnswerList({ onOpen, onCreate }: Props) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | "active" | "disabled">("");
  const [valueKind, setValueKind] = useState<"" | AnswerValueKind>("");
  const filters = useMemo(
    () => ({
      q: q || undefined,
      status: status || undefined,
      value_kind: valueKind || undefined,
      limit: 30,
    }),
    [q, status, valueKind],
  );
  const query = useFormFillAnswers(filters);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const filteredEmpty = !query.isLoading && items.length === 0 && (!!q || !!status || !!valueKind);

  return (
    <section aria-labelledby="answers-title" className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 id="answers-title" className="text-xl font-semibold text-ink">
            Answers
          </h2>
          <p className="text-sm text-ink-muted">Verified facts you control.</p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="ml-auto inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white"
        >
          <Plus size={16} /> Create Answer
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-sm text-ink">
          Search Answers
          <input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            className="mt-1 w-full rounded border border-line bg-surface px-3 py-2"
          />
        </label>
        <label className="text-sm text-ink">
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
            className="mt-1 w-full rounded border border-line bg-surface px-3 py-2"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </label>
        <label className="text-sm text-ink">
          Value type
          <select
            value={valueKind}
            onChange={(event) => setValueKind(event.target.value as typeof valueKind)}
            className="mt-1 w-full rounded border border-line bg-surface px-3 py-2"
          >
            <option value="">All types</option>
            {Object.entries(VALUE_KIND_LABEL).map(([kind, label]) => (
              <option key={kind} value={kind}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {query.isLoading ? (
        <p role="status" className="text-sm text-ink-muted">
          Loading Answers…
        </p>
      ) : query.isError ? (
        <div role="alert" className="space-y-2 text-sm text-red-700 dark:text-red-300">
          <p>Couldn’t load Answers.</p>
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
            {filteredEmpty ? "No Answers match these filters." : "No Answers yet."}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {filteredEmpty
              ? "Clear a filter to see more."
              : "Create one here or promote a remembered value from Needs review."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <ul className="divide-y divide-line">
            {items.map((answer: AnswerListItem) => (
              <li key={answer.id}>
                <button
                  type="button"
                  onClick={() => onOpen(answer.id)}
                  className="grid w-full gap-1 p-4 text-left hover:bg-surface-hover sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{answer.label}</span>
                    <span className="block truncate text-xs text-ink-muted">
                      {answer.description || answer.answer_key}
                    </span>
                  </span>
                  <span className="text-xs text-ink-muted">
                    {VALUE_KIND_LABEL[answer.value_kind]} · {POLICY_LABEL[answer.fill_policy]} ·{" "}
                    {answer.status}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {answer.mapping_count} Matches · {formatDate(answer.updated_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
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
