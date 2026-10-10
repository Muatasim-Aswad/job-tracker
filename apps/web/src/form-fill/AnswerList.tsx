import { useMemo, useState } from "react";
import type { AnswerFilters } from "../api/client";
import { SortChoiceMenu } from "../components/SortMenu";
import { Plus } from "lucide-react";
import { CollectionSearch, CollectionToolbar, FilterPopover } from "./CollectionToolbar";
import { IconButton } from "../components/IconButton";
import { useFormFillAnswers } from "../hooks";
import { POLICY_LABEL, VALUE_KIND_LABEL, type AnswerListItem, type AnswerValueKind } from "./model";

const ORDER_OPTIONS = [
  { value: "updated_at", label: "Most recent" },
  { value: "mapping_count", label: "Most matched questions" },
  { value: "label", label: "A–Z" },
] as const;

interface Props {
  toolbarHost?: HTMLElement | null;
  onOpen: (answerId: string) => void;
  onCreate: () => void;
}

export function AnswerList({ toolbarHost, onOpen, onCreate }: Props) {
  const [sort, setSort] = useState<NonNullable<AnswerFilters["sort"]>>("updated_at");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | "active" | "disabled">("active");
  const [valueKind, setValueKind] = useState<"" | AnswerValueKind>("");
  const filtersApplied = status !== "active" || !!valueKind;
  const filters = useMemo(
    () => ({
      q: q || undefined,
      status: status || undefined,
      value_kind: valueKind || undefined,
      sort,
      limit: 30,
    }),
    [q, status, valueKind, sort],
  );
  const query = useFormFillAnswers(filters);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const filteredEmpty =
    !query.isLoading && items.length === 0 && (!!q || status !== "active" || !!valueKind);

  return (
    <section aria-label="Saved answers" className="space-y-4">
      <CollectionToolbar host={toolbarHost}>
        <CollectionSearch
          label="Search saved answers"
          placeholder="Search saved answers"
          value={q}
          onChange={setQ}
          count={query.isLoading || query.isError ? null : items.length}
          loading={query.isLoading}
          hasNextPage={query.hasNextPage}
          itemName="answer"
        />
        <SortChoiceMenu
          value={sort}
          onChange={setSort}
          options={ORDER_OPTIONS}
          menuLabel="Order saved answers"
          actionLabel="Order"
          size="field"
          className="border border-line bg-surface text-ink"
        />
        <FilterPopover applied={filtersApplied} label="Saved answer filters">
          <label className="block text-xs text-ink-muted">
            Status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as typeof status)}
              className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-sm font-normal text-ink"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="disabled">Paused</option>
            </select>
          </label>
          <label className="block text-xs text-ink-muted">
            Value type
            <select
              value={valueKind}
              onChange={(event) => setValueKind(event.target.value as typeof valueKind)}
              className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-sm font-normal text-ink"
            >
              <option value="">All types</option>
              {Object.entries(VALUE_KIND_LABEL).map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </FilterPopover>
        <IconButton
          type="button"
          label="New answer"
          size="field"
          onClick={onCreate}
          className="border border-line bg-surface text-ink"
        >
          <Plus size={16} aria-hidden="true" />
        </IconButton>
      </CollectionToolbar>
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
                  className={`grid w-full gap-2 px-4 py-3 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4 ${answer.status === "disabled" ? "bg-sunken border-l-4 border-line-strong" : ""}`}
                >
                  <span className="min-w-0">
                    <span className="block text-base font-medium leading-6 text-ink">
                      {answer.label}
                    </span>
                    {answer.description && (
                      <span className="mt-0.5 line-clamp-1 block text-prose text-ink-muted">
                        {answer.description}
                      </span>
                    )}
                    <span className="mt-1 block text-xs text-ink-muted">
                      {VALUE_KIND_LABEL[answer.value_kind]} • {answer.mapping_count}{" "}
                      {answer.mapping_count === 1 ? "question" : "questions"}
                    </span>
                  </span>
                  <span
                    className={`w-fit rounded-full px-3 py-1 text-xs font-medium ${answer.status === "disabled" ? "bg-surface text-ink-muted" : "bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200"}`}
                  >
                    {answer.status === "disabled" ? "Paused" : POLICY_LABEL[answer.fill_policy]}
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
