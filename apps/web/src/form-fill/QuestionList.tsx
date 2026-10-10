import { useDeferredValue, useEffect, useState } from "react";
import { useFormFillQuestions } from "../hooks";
import { CONTROL_LABEL, siteLabel } from "./model";
import { ReviewFilterSelect, ReviewList } from "./ReviewList";

interface Props {
  onOpen: (questionId: string) => void;
  mode?: "inbox" | "all" | "muted";
  onItemsChange?: (ids: string[]) => void;
}

export function QuestionList({ onOpen, mode = "inbox", onItemsChange }: Props) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"last_seen" | "seen_count">("seen_count");
  const q = useDeferredValue(search.trim());
  const query = useFormFillQuestions({
    review_inbox: mode === "inbox" ? true : undefined,
    review_state: mode === "muted" ? "ignored" : undefined,
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
      titleId="questions-title"
      title={
        mode === "inbox"
          ? "Questions to review"
          : mode === "muted"
            ? "Dismissed questions"
            : "All questions"
      }
      filters={
        <>
          <label className="min-w-0 basis-64 flex-1 text-sm font-medium text-ink">
            Search questions
            <input
              type="search"
              value={search}
              maxLength={256}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search the question, section or help text"
              className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2"
            />
          </label>
          <ReviewFilterSelect
            label="Order"
            value={sort}
            onChange={setSort}
            options={[
              ["seen_count", "Most used"],
              ["last_seen", "Most recent"],
            ]}
          />
        </>
      }
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => void query.refetch()}
      loadingLabel="Loading questions…"
      errorLabel="Couldn’t load questions."
      emptyTitle={
        q
          ? "No questions match your search."
          : mode === "inbox"
            ? "You’re all caught up."
            : "No questions here."
      }
      emptyBody={
        q
          ? "Try another search."
          : mode === "inbox"
            ? "New questions and remembered values will appear here after you use a supported application form."
            : "Questions observed by the extension will appear here."
      }
      rows={items.map((question) => ({
        id: question.id,
        title: question.raw_question,
        badge: question.capture_conflict
          ? "Conflicting values"
          : question.current_capture_count
            ? "Remembered value"
            : question.review_state === "ignored"
              ? "Dismissed"
              : !question.mapping
                ? "Choose an answer"
                : question.mapping.status === "active"
                  ? "Matched"
                  : "Filling paused",
        warning: question.capture_conflict,
        meta: `${siteLabel(question.site_scope)} • Seen ${question.seen_count} ${question.seen_count === 1 ? "time" : "times"}`,
        context: [
          question.raw_section,
          CONTROL_LABEL[question.control_kind],
          question.raw_help,
          question.option_count ? `${question.option_count} form choices` : null,
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
