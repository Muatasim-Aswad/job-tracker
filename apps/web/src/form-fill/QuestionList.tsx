import { useDeferredValue, useEffect, useState } from "react";
import { useFormFillQuestions } from "../hooks";
import { CONTROL_LABEL, siteLabel } from "./model";
import { ReviewList } from "./ReviewList";
import { HelpTip } from "./HelpTip";
import { CollectionSearch } from "./CollectionToolbar";
import { SortChoiceMenu } from "../components/SortMenu";

const ORDER_OPTIONS = [
  { value: "last_seen", label: "Most recent" },
  { value: "seen_count", label: "Most seen" },
  { value: "prompt", label: "A–Z" },
] as const;

interface Props {
  toolbarHost?: HTMLElement | null;
  onOpen: (questionId: string) => void;
  includeMatched?: boolean;
  includeDismissed?: boolean;
  onIncludeMatchedChange: (checked: boolean) => void;
  onIncludeDismissedChange: (checked: boolean) => void;
  onItemsChange?: (ids: string[]) => void;
}

export function QuestionList({
  toolbarHost,
  onOpen,
  includeMatched = false,
  includeDismissed = false,
  onIncludeMatchedChange,
  onIncludeDismissedChange,
  onItemsChange,
}: Props) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"last_seen" | "seen_count" | "prompt">("last_seen");
  const q = useDeferredValue(search.trim());
  const query = useFormFillQuestions({
    review_inbox: true,
    review_state: includeDismissed ? undefined : "open",
    include_matched: includeMatched,
    include_dismissed: includeDismissed,
    q: q || undefined,
    sort,
    limit: 30,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  useEffect(() => {
    onItemsChange?.(query.data?.pages.flatMap((page) => page.items.map((item) => item.id)) ?? []);
  }, [query.data, onItemsChange]);
  return (
    <ReviewList
      toolbarHost={toolbarHost}
      filtersApplied={includeMatched || includeDismissed}
      titleId="questions-title"
      title={includeMatched || includeDismissed ? "All matching questions" : "Questions to review"}
      filters={
        <>
          <CollectionSearch
            label="Search questions"
            placeholder="Search questions, sections or help"
            value={search}
            onChange={setSearch}
            count={query.isLoading || query.isError ? null : items.length}
            loading={query.isLoading}
            hasNextPage={query.hasNextPage}
            itemName="question"
            maxLength={256}
          />
          <SortChoiceMenu
            value={sort}
            onChange={setSort}
            options={ORDER_OPTIONS}
            menuLabel="Order questions"
            actionLabel="Order"
            size="field"
            className="border border-line bg-surface text-ink"
          />
        </>
      }
      listControls={
        <div role="group" aria-label="Include questions" className="space-y-3">
          <p className="text-xs text-ink-muted">Include questions</p>
          <label className="flex cursor-pointer items-center gap-2">
            <HelpTip text="Include questions already matched to a saved answer.">
              <input
                type="checkbox"
                checked={includeMatched}
                onChange={(event) => onIncludeMatchedChange(event.target.checked)}
              />
            </HelpTip>
            Matched
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <HelpTip text="Include dismissed questions. Open one to reopen it.">
              <input
                type="checkbox"
                checked={includeDismissed}
                onChange={(event) => onIncludeDismissedChange(event.target.checked)}
              />
            </HelpTip>
            Dismissed
          </label>
        </div>
      }
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => void query.refetch()}
      loadingLabel="Loading questions…"
      errorLabel="Couldn’t load questions."
      emptyTitle={
        q
          ? "No questions match your search."
          : !includeMatched && !includeDismissed
            ? "You’re all caught up."
            : "No questions here."
      }
      emptyBody={
        q
          ? "Try another search."
          : !includeMatched && !includeDismissed
            ? "New questions and remembered values will appear here after you use a supported application form."
            : "Questions observed by the extension will appear here."
      }
      rows={items.map((question) => ({
        id: question.id,
        title: question.raw_question,
        badge:
          question.review_state === "ignored"
            ? "Dismissed"
            : question.capture_conflict
              ? "Conflicting values"
              : question.current_capture_count
                ? "Remembered value"
                : !question.mapping
                  ? "Choose an answer"
                  : question.mapping.status === "active"
                    ? "Matched"
                    : "Filling paused",
        secondaryBadge: question.ignored_capture_count
          ? question.ignored_capture_count === 1
            ? "Value cleared"
            : `${question.ignored_capture_count} values cleared`
          : undefined,
        warning: question.review_state !== "ignored" && question.capture_conflict,
        meta: `${siteLabel(question.site_scope)} • Seen ${question.seen_count} ${question.seen_count === 1 ? "time" : "times"}`,
        context: [
          question.raw_section,
          CONTROL_LABEL[question.control_kind],
          question.raw_help,
          question.option_count ? `${question.option_count} choices` : null,
        ]
          .filter(Boolean)
          .join(" • "),
        aside:
          question.current_capture_count > 1
            ? `${question.current_capture_count} remembered values`
            : "",
      }))}
      onOpen={onOpen}
      hasNextPage={query.hasNextPage}
      isFetchingNextPage={query.isFetchingNextPage}
      onLoadMore={() => void query.fetchNextPage()}
    />
  );
}
