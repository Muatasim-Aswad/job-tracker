import type { ReactNode } from "react";

export interface ReviewListRow {
  id: string;
  title: ReactNode;
  meta: ReactNode;
  aside: ReactNode;
}

interface Props {
  titleId: string;
  title: string;
  description: string;
  filters: ReactNode;
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
  titleId,
  title,
  description,
  filters,
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
  return (
    <section aria-labelledby={titleId} className="space-y-4">
      <div>
        <h3 id={titleId} className="text-lg font-semibold text-ink">
          {title}
        </h3>
        <p className="text-sm text-ink-muted">{description}</p>
      </div>
      <div role="group" aria-label="Filters" className="flex flex-wrap gap-3">
        {filters}
      </div>
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
                className="grid w-full gap-1 p-4 text-left hover:bg-surface-hover sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <span>
                  <span className="block font-medium text-ink">{row.title}</span>
                  <span className="text-xs text-ink-muted">{row.meta}</span>
                </span>
                <span className="text-xs text-ink-muted">{row.aside}</span>
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
    <label className="text-sm text-ink">
      {label}{" "}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="ml-2 rounded border border-line bg-surface px-2 py-1.5"
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
