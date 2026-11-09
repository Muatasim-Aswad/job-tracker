import { copy } from "./copy";
import { useDeferredValue, useEffect, useState } from "react";
import { usePersistentChoice } from "../../shared/usePersistentChoice";
import { useFormFillQuestions } from "./queries";
import { siteLabel } from "./model";
import { CONTROL_LABEL } from "./copy";
import { ReviewList } from "./ReviewList";
import { HelpTip } from "./HelpTip";
import { SortChoiceMenu } from "../jobs/SortMenu";

const ORDER_OPTIONS = [
  { value: "last_seen", label: copy.questionList.mostRecent },
  { value: "seen_count", label: copy.questionList.mostSeen },
  { value: "prompt", label: copy.questionList.aZ },
] as const;

interface Props {
  toolbarHost?: HTMLElement | null;
  onOpen: (questionId: string) => void;
  includeMatched?: boolean;
  includeDismissed?: boolean;
  onIncludeMatchedChange: (checked: boolean) => void;
  onIncludeDismissedChange: (checked: boolean) => void;
  onClearInclusions: () => void;
  onItemsChange?: (ids: string[]) => void;
}

export function QuestionList({
  toolbarHost,
  onOpen,
  includeMatched = false,
  includeDismissed = false,
  onIncludeMatchedChange,
  onIncludeDismissedChange,
  onClearInclusions,
  onItemsChange,
}: Props) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = usePersistentChoice(
    "jt.formFill.questionOrder",
    ORDER_OPTIONS.map((option) => option.value),
    "last_seen",
  );
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
      title={
        includeMatched || includeDismissed
          ? copy.questionListMessages.allMatchingQuestions
          : copy.questionListMessages.questionsToReview
      }
      search={{
        label: copy.questionList.searchQuestions,
        placeholder: copy.questionList.searchQuestionsSectionsOrHelp,
        value: search,
        onChange: setSearch,
        count: query.isLoading || (query.isError && !query.data) ? null : items.length,
        loading: query.isLoading,
        hasNextPage: query.hasNextPage,
        itemName: "question",
        maxLength: 256,
      }}
      onClearFilters={() => {
        setSearch("");
        onClearInclusions();
      }}
      orderControl={
        <SortChoiceMenu
          value={sort}
          onChange={setSort}
          options={ORDER_OPTIONS}
          menuLabel={copy.questionList.orderQuestions}
          actionLabel={copy.collectionOrder}
          size="field"
        />
      }
      listControls={
        <div role="group" aria-label={copy.questionList.includeQuestions} className="space-y-3">
          <p className="text-xs text-ink-muted">{copy.questionList.includeQuestions}</p>
          <label className="flex cursor-pointer items-center gap-2">
            <HelpTip text={copy.questionList.includeQuestionsAlreadyMatchedToASavedAnswer}>
              <input
                type="checkbox"
                checked={includeMatched}
                onChange={(event) => onIncludeMatchedChange(event.target.checked)}
              />
            </HelpTip>
            {copy.questionList.matched}
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <HelpTip text={copy.questionList.includeDismissedQuestionsOpenOneToReopenIt}>
              <input
                type="checkbox"
                checked={includeDismissed}
                onChange={(event) => onIncludeDismissedChange(event.target.checked)}
              />
            </HelpTip>
            {copy.questionList.dismissed}
          </label>
        </div>
      }
      isLoading={query.isLoading}
      isError={query.isError && !query.data}
      onRetry={() => void query.refetch()}
      loadingLabel={copy.questionList.loadingQuestions}
      errorLabel={copy.questionList.couldnTLoadQuestions}
      emptyTitle={
        q
          ? copy.questionList.noQuestionsMatchYourSearch
          : !includeMatched && !includeDismissed
            ? copy.questionList.youReAllCaughtUp
            : copy.questionList.noQuestionsHere
      }
      emptyBody={
        q
          ? copy.questionList.tryAnotherSearch
          : !includeMatched && !includeDismissed
            ? copy.questionList.newQuestionsAndRememberedValuesWillAppearHereAfter
            : copy.questionList.questionsObservedByTheExtensionWillAppearHere
      }
      rows={items.map((question) => ({
        id: question.id,
        title: question.raw_question,
        badge:
          question.review_state === "ignored"
            ? "Dismissed"
            : question.capture_conflict
              ? copy.questionList.conflictingValues
              : question.current_capture_count
                ? copy.questionList.rememberedValue
                : !question.mapping
                  ? copy.questionList.chooseAnAnswer
                  : question.mapping.status === "active"
                    ? "Matched"
                    : copy.questionList.fillingPaused,
        secondaryBadge: question.ignored_capture_count
          ? question.ignored_capture_count === 1
            ? copy.questionList.valueCleared
            : copy.questionList.valuesCleared(question.ignored_capture_count)
          : undefined,
        warning: question.review_state !== "ignored" && question.capture_conflict,
        meta: copy.answerUsage.seen(siteLabel(question.site_scope), question.seen_count),
        context: [
          question.raw_section,
          CONTROL_LABEL[question.control_kind],
          question.raw_help,
          question.option_count ? copy.questionList.choices(question.option_count) : null,
        ]
          .filter(Boolean)
          .join(" • "),
        aside:
          question.current_capture_count > 1
            ? copy.questionList.rememberedValues(question.current_capture_count)
            : "",
      }))}
      onOpen={onOpen}
      hasNextPage={query.hasNextPage}
      isFetchingNextPage={query.isFetchingNextPage}
      onLoadMore={() => void query.fetchNextPage()}
      onPrefetch={() => void query.prefetchNextPage()}
      isNextPageError={query.isFetchNextPageError}
      continuationKey={query.data?.pages.at(-1)?.next_cursor ?? ""}
    />
  );
}
