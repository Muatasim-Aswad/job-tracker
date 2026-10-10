import { useDeferredValue, useState } from "react";
import { useFormFillAnswers } from "../hooks";
import { HelpTip } from "./HelpTip";
import {
  controlAcceptsAnswer,
  fillExplanation,
  POLICY_LABEL,
  valueText,
  type AnswerDetail,
  type QuestionDetail,
} from "./model";

interface Props {
  control: QuestionDetail["control_kind"];
  prompt: string;
  value: string;
  selected?: AnswerDetail;
  loading?: boolean;
  error?: boolean;
  onRetry: () => void;
  onChange: (id: string) => void;
}

export function AnswerPicker({
  control,
  prompt,
  value,
  selected,
  loading,
  error,
  onRetry,
  onChange,
}: Props) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(!value);
  const q = useDeferredValue(search.trim());
  const query = useFormFillAnswers({ status: "active", q: q || undefined, limit: 30 });
  const terms = new Set(
    prompt
      .toLocaleLowerCase()
      .split(/\W+/)
      .filter((term) => term.length > 2),
  );
  const score = (label: string) =>
    label
      .toLocaleLowerCase()
      .split(/\W+/)
      .filter((term) => terms.has(term)).length;
  const answers = (query.data?.pages.flatMap((page) => page.items) ?? [])
    .filter((answer) => controlAcceptsAnswer(control, answer.value_kind))
    .sort(
      (left, right) =>
        score(right.label) - score(left.label) || left.label.localeCompare(right.label),
    );
  return (
    <section aria-label="Choose a saved answer" className="space-y-3">
      {value && (
        <div className="rounded-lg border border-accent/40 bg-surface p-4">
          {loading ? (
            <p role="status">Loading answer preview…</p>
          ) : error ? (
            <p role="alert">
              Couldn’t load this answer.{" "}
              <button type="button" className="underline" onClick={onRetry}>
                Retry
              </button>
            </p>
          ) : selected ? (
            <>
              <p className="font-semibold text-ink">{selected.label}</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-lg text-ink">
                {valueText(selected.value, selected.choices)}
              </p>
              <p className="mt-2 text-sm text-ink-muted">
                {fillExplanation(selected.fill_policy, selected.status)}
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                Used by {selected.mappings.length}{" "}
                {selected.mappings.length === 1 ? "question" : "questions"}.
              </p>
            </>
          ) : (
            <p role="status">Loading answer preview…</p>
          )}
          <button
            type="button"
            className="mt-3 text-sm font-medium text-accent"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Hide answer search" : "Choose a different answer"}
          </button>
        </div>
      )}
      {(expanded || !value) && (
        <>
          <div className="flex items-end gap-2">
            <label className="block flex-1 text-sm font-medium text-ink">
              Find a saved answer
              <input
                type="search"
                value={search}
                maxLength={256}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name or description"
                className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2"
              />
            </label>
            <HelpTip
              label="About answer selection"
              text="Compatible answers, with similar names first. Check the value before saving."
            />
          </div>
          {query.isLoading ? (
            <p role="status">Loading answers…</p>
          ) : query.isError ? (
            <p role="alert">
              Couldn’t load answers.{" "}
              <button type="button" className="underline" onClick={() => void query.refetch()}>
                Retry
              </button>
            </p>
          ) : (
            <ul className="max-h-60 divide-y divide-line overflow-y-auto rounded-md border border-line bg-surface">
              {answers.map((answer) => (
                <li key={answer.id}>
                  <button
                    type="button"
                    aria-pressed={value === answer.id}
                    onClick={() => {
                      onChange(answer.id);
                      setExpanded(false);
                    }}
                    className="w-full px-3 py-3 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <span className="block font-medium text-ink">{answer.label}</span>
                    <span className="block text-sm text-ink-muted">
                      {answer.description || POLICY_LABEL[answer.fill_policy]}
                    </span>
                  </button>
                </li>
              ))}
              {!answers.length && (
                <li className="p-3 text-sm text-ink-muted">
                  No compatible answers on this page. Try another search, load more, or save a new
                  answer.
                </li>
              )}
            </ul>
          )}
          {query.hasNextPage && (
            <button
              type="button"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
              className="rounded border border-line px-3 py-2 text-sm"
            >
              {query.isFetchingNextPage ? "Loading…" : "Load more answers"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
