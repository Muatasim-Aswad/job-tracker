import { useDeferredValue, useState } from "react";
import { Plus, X } from "lucide-react";
import { IconButton } from "../components/IconButton";
import { useFormFillAnswerCandidates } from "../hooks";
import { ListContinuation } from "./ListContinuation";
import { FormFillApiError } from "../api/client";
import { HelpTip } from "./HelpTip";
import { fillExplanation, POLICY_LABEL, valueText, type AnswerDetail } from "./model";

interface Props {
  questionId: string;
  questionRevision: number;
  value: string;
  selected?: AnswerDetail;
  loading?: boolean;
  error?: boolean;
  onRetry: () => void;
  onChange: (id: string) => void;
  onCreate?: () => void;
}

export function AnswerPicker({
  questionId,
  questionRevision,
  value,
  selected,
  loading,
  error,
  onRetry,
  onChange,
  onCreate,
}: Props) {
  const [search, setSearch] = useState("");
  const [scrollRoot, setScrollRoot] = useState<HTMLUListElement | null>(null);
  const q = useDeferredValue(search.trim());
  const query = useFormFillAnswerCandidates(
    questionId,
    questionRevision,
    { q: q || undefined, limit: 30 },
    !value,
  );
  const answers = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <section aria-label="Choose a saved answer" className="space-y-3">
      {!value && (
        <>
          <div className="flex items-center gap-2">
            <label className="block min-w-0 flex-1 text-xs font-normal text-ink-muted">
              <span className="sr-only">Find a saved answer</span>
              <HelpTip
                text="Suggested answers match the field type and options. Search other answers with a compatible type and option count. Check the value and bindings before saving."
                className="block"
              >
                <input
                  type="search"
                  value={search}
                  maxLength={256}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search matching existing answers"
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
          ) : query.isError && !query.data ? (
            <p role="alert">
              Couldn’t load answers.{" "}
              <button type="button" className="underline" onClick={() => void query.refetch()}>
                Retry
              </button>
            </p>
          ) : (
            <ul
              ref={setScrollRoot}
              className="max-h-60 divide-y divide-line overflow-y-auto rounded-md border border-line bg-surface"
            >
              {answers.map((answer) => (
                <li key={answer.id}>
                  <button
                    type="button"
                    aria-pressed={value === answer.id}
                    onClick={() => {
                      onChange(answer.id);
                    }}
                    className="w-full space-y-1.5 px-4 py-3 text-left hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <span className="block text-sm font-medium leading-5 text-ink-muted">
                      {answer.label}
                    </span>
                    <span className="line-clamp-2 block break-words text-base font-normal leading-6 text-ink">
                      {answer.value_preview}
                    </span>
                  </button>
                </li>
              ))}
              {!answers.length && (
                <li className="p-3 text-sm text-ink-muted">
                  {q ? "No compatible answers match your search." : "No suggested matches."}{" "}
                  {q ? "Try another search" : "Search for another answer"}
                  {onCreate ? " or create a new answer" : ""}.
                </li>
              )}
              {(query.hasNextPage || query.isFetchNextPageError) && (
                <li>
                  <ListContinuation
                    automatic
                    root={scrollRoot}
                    hasMore={query.hasNextPage}
                    loading={query.isFetchingNextPage}
                    failed={query.isFetchNextPageError}
                    pageKey={query.data?.pages.at(-1)?.next_cursor ?? ""}
                    onLoad={() => {
                      if (query.error instanceof FormFillApiError && query.error.status === 400)
                        void query.refetch();
                      else void query.fetchNextPage();
                    }}
                  />
                </li>
              )}
            </ul>
          )}
        </>
      )}
      {value && (
        <div className="relative rounded-lg border border-accent/40 bg-surface p-4 pr-14">
          <IconButton
            label="Cancel answer selection"
            onClick={() => onChange("")}
            className="absolute right-2 top-2 text-ink-muted"
          >
            <X size={16} aria-hidden="true" />
          </IconButton>
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
