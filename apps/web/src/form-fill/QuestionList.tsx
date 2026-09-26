import { useMemo, useState } from "react";
import { useFormFillQuestions } from "../hooks";
import { formatDate } from "./model";
import { ReviewFilterSelect, ReviewList } from "./ReviewList";

interface Props {
  onOpen: (questionId: string) => void;
}

const MAPPING_STATUS_OPTIONS = [
  ["", "All"],
  ["none", "No Match"],
  ["active", "Active"],
  ["disabled", "Disabled"],
  ["retired", "Retired"],
] as const;

const SORT_OPTIONS = [
  ["last_seen", "Most recent"],
  ["seen_count", "Most seen"],
] as const;

export function QuestionList({ onOpen }: Props) {
  const [mappingStatus, setMappingStatus] =
    useState<(typeof MAPPING_STATUS_OPTIONS)[number][0]>("");
  const [sort, setSort] = useState<(typeof SORT_OPTIONS)[number][0]>("last_seen");
  const filters = useMemo(
    () => ({
      needs_review: true,
      mapping_status: mappingStatus || undefined,
      sort,
      limit: 30,
    }),
    [mappingStatus, sort],
  );
  const query = useFormFillQuestions(filters);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <ReviewList
      titleId="questions-title"
      title="Unresolved Questions"
      description="Exact field variants that still need a safe decision."
      filters={
        <>
          <ReviewFilterSelect
            label="Match state"
            value={mappingStatus}
            onChange={setMappingStatus}
            options={MAPPING_STATUS_OPTIONS}
          />
          <ReviewFilterSelect
            label="Order"
            value={sort}
            onChange={setSort}
            options={SORT_OPTIONS}
          />
        </>
      }
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => void query.refetch()}
      loadingLabel="Loading Questions…"
      errorLabel="Couldn’t load unresolved Questions."
      emptyTitle={mappingStatus ? "No Questions match this filter." : "No Questions need review."}
      emptyBody="Questions seen by the extension will appear here when they need a decision."
      rows={items.map((question) => ({
        id: question.id,
        title: question.raw_question,
        meta: `${question.site_scope} · ${question.control_kind} · seen ${question.seen_count} times`,
        aside: `${question.capture_conflict ? "Remembered-value conflict · " : ""}${question.mapping ? `Match ${question.mapping.status} · ` : "No Match · "}${formatDate(question.last_seen_at)}`,
      }))}
      onOpen={onOpen}
      hasNextPage={query.hasNextPage}
      isFetchingNextPage={query.isFetchingNextPage}
      onLoadMore={() => void query.fetchNextPage()}
    />
  );
}
