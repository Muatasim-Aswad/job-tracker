import { useMemo, useState } from "react";
import { useFormFillCaptures, useFormFillQuestions } from "../hooks";
import { SOURCE_LABEL, VALUE_KIND_LABEL, formatDate, type CaptureRecordSummary } from "./model";

interface Props {
  onOpen: (captureId: string) => void;
}

export function CaptureList({ onOpen }: Props) {
  const [source, setSource] = useState<"" | CaptureRecordSummary["source"]>("");
  const filters = useMemo(
    () => ({ status: "current" as const, source: source || undefined, limit: 30 }),
    [source],
  );
  const query = useFormFillCaptures(filters);
  const questionsQuery = useFormFillQuestions({ has_current_capture: true, limit: 100 });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const questions = new Map(
    (questionsQuery.data?.pages.flatMap((page) => page.items) ?? []).map((question) => [
      question.id,
      question,
    ]),
  );
  return (
    <section aria-labelledby="captures-title" className="space-y-4">
      <div>
        <h3 id="captures-title" className="text-lg font-semibold text-ink">
          Remembered values
        </h3>
        <p className="text-sm text-ink-muted">Provisional values kept for one exact Question.</p>
      </div>
      <label className="text-sm text-ink">
        Source{" "}
        <select
          value={source}
          onChange={(event) => setSource(event.target.value as typeof source)}
          className="ml-2 rounded border border-line bg-surface px-2 py-1.5"
        >
          <option value="">All sources</option>
          <option value="user_input">You typed this</option>
          <option value="confirmed_external">You chose to remember this</option>
          <option value="unattributed_change">Source uncertain</option>
        </select>
      </label>
      {query.isLoading || questionsQuery.isLoading ? (
        <p role="status" className="text-sm text-ink-muted">
          Loading remembered values…
        </p>
      ) : query.isError || questionsQuery.isError ? (
        <div role="alert" className="space-y-2 text-sm text-red-700 dark:text-red-300">
          <p>Couldn’t load remembered values.</p>
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
            {source
              ? "No remembered values match this filter."
              : "No remembered values need review."}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            Eligible answers you enter in application forms will appear here.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {items.map((capture: CaptureRecordSummary) => {
            const question = questions.get(capture.question_id);
            return (
              <li key={capture.id}>
                <button
                  type="button"
                  onClick={() => onOpen(capture.id)}
                  className="grid w-full gap-1 p-4 text-left hover:bg-surface-hover sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <span>
                    <span className="block font-medium text-ink">
                      {question?.raw_question ??
                        `Remembered ${VALUE_KIND_LABEL[capture.value_kind]} value`}
                    </span>
                    <span className="text-xs text-ink-muted">
                      {SOURCE_LABEL[capture.source]} · exact Question only
                      {question?.capture_conflict ? " · Conflict — fills nothing" : ""}
                    </span>
                  </span>
                  <span className="text-xs text-ink-muted">
                    Revision {capture.revision} · {formatDate(capture.updated_at)}
                  </span>
                </button>
              </li>
            );
          })}
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
