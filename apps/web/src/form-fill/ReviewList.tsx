import { FilterPopover } from "../components/FilterPopover";
import { useState, type ReactNode } from "react";
import {
  CollectionSearch,
  CollectionToolbar,
  type CollectionSearchProps,
} from "./CollectionToolbar";

export interface ReviewListRow {
  id: string;
  title: ReactNode;
  meta: ReactNode;
  aside: ReactNode;
  badge?: string;
  secondaryBadge?: string;
  warning?: boolean;
  context?: string;
}

interface Props {
  toolbarHost?: HTMLElement | null;
  filtersApplied?: boolean;
  titleId: string;
  title: string;
  filters?: ReactNode;
  search?: CollectionSearchProps;
  orderControl?: ReactNode;
  onClearFilters?: () => void;
  listControls?: ReactNode;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  loadingLabel: string;
  errorLabel: string;
  emptyTitle: string;
  emptyBody: string;
  rows: ReviewListRow[];
  onOpen: (id: string) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}

export function ReviewList({
  toolbarHost,
  filtersApplied = false,
  titleId,
  title,
  filters,
  search,
  orderControl,
  onClearFilters,
  listControls,
  isLoading,
  isError,
  onRetry,
  loadingLabel,
  errorLabel,
  emptyTitle,
  emptyBody,
  rows,
  onOpen,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: Props) {
  const [showQuestionDetails, setShowQuestionDetails] = useState(true);
  const [showSourceDetails, setShowSourceDetails] = useState(false);
  const applied = filtersApplied || !showQuestionDetails || showSourceDetails;
  const clearFilters = () => {
    setShowQuestionDetails(true);
    setShowSourceDetails(false);
    onClearFilters?.();
  };
  return (
    <section id={titleId} aria-label={title} className="space-y-4">
      <CollectionToolbar host={toolbarHost}>
        {search && <CollectionSearch {...search} active={applied} onClear={clearFilters} />}
        {filters}
        <FilterPopover applied={applied} label="List options">
          {listControls}
          <div className="space-y-3 border-t border-line pt-3">
            <p className="text-xs text-ink-muted">Display</p>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={showQuestionDetails}
                onChange={(event) => setShowQuestionDetails(event.target.checked)}
                className="accent-accent"
              />
              Show question details
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={showSourceDetails}
                onChange={(event) => setShowSourceDetails(event.target.checked)}
                className="accent-accent"
              />
              Show source details
            </label>
          </div>
        </FilterPopover>
        {orderControl}
      </CollectionToolbar>
      {isLoading ? (
        <p role="status" className="text-sm text-ink-muted">
          {loadingLabel}
        </p>
      ) : isError ? (
        <div role="alert" className="space-y-2 text-sm text-red-700 dark:text-red-300">
          <p>{errorLabel}</p>
          <button type="button" onClick={onRetry} className="font-medium underline">
            Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line p-8 text-center">
          <p className="font-medium text-ink">{emptyTitle}</p>
          <p className="mt-1 text-sm text-ink-muted">{emptyBody}</p>
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onOpen(row.id)}
                className="grid w-full gap-2 px-4 py-3 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <span>
                  <span className="block max-w-prose text-base font-medium leading-6 text-ink">
                    {row.title}
                  </span>
                  {showQuestionDetails && row.context && (
                    <span
                      title={row.context}
                      className="mt-0.5 line-clamp-2 max-w-prose text-prose text-ink-muted"
                    >
                      {row.context}
                    </span>
                  )}
                  {showSourceDetails && (
                    <span className="mt-1 block text-xs text-ink-muted">{row.meta}</span>
                  )}
                </span>
                <span className="flex items-center gap-2 sm:flex-col sm:items-end">
                  <span className="flex flex-wrap gap-1.5 sm:justify-end">
                    {row.badge && (
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${row.warning ? "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200" : "bg-sunken text-ink-soft"}`}
                      >
                        {row.badge}
                      </span>
                    )}
                    {row.secondaryBadge && (
                      <span className="rounded-full bg-sunken px-2.5 py-1 text-xs text-ink-muted">
                        {row.secondaryBadge}
                      </span>
                    )}
                  </span>
                  {row.aside && <span className="text-xs text-ink-muted">{row.aside}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {hasNextPage && (
        <button
          type="button"
          disabled={isFetchingNextPage}
          onClick={onLoadMore}
          className="rounded border border-line bg-surface px-3 py-2 text-sm font-medium text-ink disabled:opacity-50"
        >
          {isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}

interface FilterSelectProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly (readonly [T, string])[];
}

export function ReviewFilterSelect<T extends string>({
  label,
  value,
  onChange,
  options,
}: FilterSelectProps<T>) {
  return (
    <label className="text-xs text-ink-muted">
      {label}{" "}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="ml-2 rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}
