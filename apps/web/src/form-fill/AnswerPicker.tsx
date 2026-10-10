import { useDeferredValue, useState } from "react";
import { Check, Plus } from "lucide-react";
import { IconButton } from "../components/IconButton";
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
  valueHelp?: string | null;
  loading?: boolean;
  error?: boolean;
  onRetry: () => void;
  onChange: (id: string) => void;
  onCreate?: () => void;
}

const COMMON_QUESTION_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "your",
  "you",
  "have",
  "how",
  "many",
  "what",
  "when",
  "are",
  "can",
  "will",
  "this",
  "that",
  "work",
  "working",
  "experience",
  "years",
]);

export function AnswerPicker({
  control,
  prompt,
  value,
  selected,
  valueHelp,
  loading,
  error,
  onRetry,
  onChange,
  onCreate,
}: Props) {
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const query = useFormFillAnswers({ status: "active", q: q || undefined, limit: 30 });
  const terms = new Set(
    prompt
      .toLocaleLowerCase()
      .split(/\W+/)
      .filter((term) => term.length > 2 && !COMMON_QUESTION_WORDS.has(term)),
  );
  const score = (label: string) =>
    label
      .toLocaleLowerCase()
      .split(/\W+/)
      .filter((term) => terms.has(term)).length;
  const compatibleAnswers = (query.data?.pages.flatMap((page) => page.items) ?? [])
    .filter((answer) => controlAcceptsAnswer(control, answer.value_kind))
    .sort(
      (left, right) =>
        score(right.label) - score(left.label) || left.label.localeCompare(right.label),
    );
  const answers = compatibleAnswers;
  return (
    <section aria-label="Choose a saved answer" className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="block min-w-0 flex-1 text-xs font-normal text-ink-muted">
          <span className="sr-only">Find a saved answer</span>
          <HelpTip
            text="Compatible answers, with similar names first. Check the value before saving."
            className="block"
          >
            <input
              type="search"
              value={search}
              maxLength={256}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search saved answers"
              className="h-[38px] w-full rounded-md border border-line bg-surface px-3 py-2 text-sm font-normal text-ink"
            />
          </HelpTip>
        </label>
        {onCreate && (
          <IconButton
            label="New answer"
            size="field"
            onClick={onCreate}
            className="border border-line bg-surface text-ink"
          >
            <Plus size={16} aria-hidden="true" />
          </IconButton>
        )}
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
        <ul className="max-h-52 divide-y divide-line overflow-y-auto rounded-md border border-line bg-surface">
          {answers.map((answer) => (
            <li key={answer.id}>
              <button
                type="button"
                aria-pressed={value === answer.id}
                onClick={() => {
                  onChange(answer.id);
                }}
                className={`w-full px-3 py-2.5 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent ${value === answer.id ? "bg-sunken" : ""}`}
              >
                <span className="flex items-center justify-between gap-3 font-medium text-ink">
                  {answer.label}
                  {value === answer.id && (
                    <Check size={16} className="shrink-0 text-accent" aria-hidden="true" />
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-ink-muted">
                  {answer.description || POLICY_LABEL[answer.fill_policy]}
                </span>
              </button>
            </li>
          ))}
          {!answers.length && (
            <li className="p-3 text-sm text-ink-muted">
              No compatible answers. Try another search
              {onCreate ? " or create a new answer" : ""}.
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
              <p className="text-xs font-normal text-ink-muted">{selected.label}</p>
              <p className="mt-2 whitespace-pre-wrap break-words text-lg text-ink">
                {valueText(selected.value, selected.choices)}
              </p>
              {valueHelp && (
                <p className="mt-1 max-w-prose text-xs leading-5 text-ink-muted">{valueHelp}</p>
              )}
              <HelpTip
                text={fillExplanation(selected.fill_policy, selected.status)}
                className="block"
              >
                <p className="mt-2 text-xs text-ink-muted">
                  {selected.status === "disabled" ? "Paused" : POLICY_LABEL[selected.fill_policy]} ·{" "}
                  {selected.mappings.length}{" "}
                  {selected.mappings.length === 1 ? "question" : "questions"}
                </p>
              </HelpTip>
            </>
          ) : (
            <p role="status">Loading answer preview…</p>
          )}
        </div>
      )}
    </section>
  );
}
