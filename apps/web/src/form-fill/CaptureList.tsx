import { useMemo, useState } from "react";
import { useFormFillCaptures, useFormFillQuestions } from "../hooks";
import { SOURCE_LABEL, VALUE_KIND_LABEL, formatDate, type CaptureRecordSummary } from "./model";
import { ReviewFilterSelect, ReviewList } from "./ReviewList";

interface Props {
  onOpen: (captureId: string) => void;
}

const SOURCE_OPTIONS = [
  ["", "All sources"],
  ["user_input", "You typed this"],
  ["confirmed_external", "You chose to remember this"],
  ["unattributed_change", "Source uncertain"],
] as const;

export function CaptureList({ onOpen }: Props) {
  const [source, setSource] = useState<"" | CaptureRecordSummary["source"]>("");
  const filters = useMemo(
    () => ({
      status: "current" as const,
      source: source || undefined,
      limit: 30,
    }),
    [source],
  );
  const query = useFormFillCaptures(filters);
  const questionsQuery = useFormFillQuestions({
    has_current_capture: true,
    limit: 100,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const questions = new Map(
    (questionsQuery.data?.pages.flatMap((page) => page.items) ?? []).map((question) => [
      question.id,
      question,
    ]),
  );
  return (
    <ReviewList
      titleId="captures-title"
      title="Remembered values"
      description="Provisional values kept for one exact Question."
      filters={
        <ReviewFilterSelect
          label="Source"
          value={source}
          onChange={setSource}
          options={SOURCE_OPTIONS}
        />
      }
      isLoading={query.isLoading || questionsQuery.isLoading}
      isError={query.isError || questionsQuery.isError}
      onRetry={() => {
        if (query.isError) void query.refetch();
        if (questionsQuery.isError) void questionsQuery.refetch();
      }}
      loadingLabel="Loading remembered values…"
      errorLabel="Couldn’t load remembered values."
      emptyTitle={
        source ? "No remembered values match this filter." : "No remembered values need review."
      }
      emptyBody="Eligible answers you enter in application forms will appear here."
      rows={items.map((capture) => {
        const question = questions.get(capture.question_id);
        return {
          id: capture.id,
          title:
            question?.raw_question ?? `Remembered ${VALUE_KIND_LABEL[capture.value_kind]} value`,
          meta: `${SOURCE_LABEL[capture.source]} · exact Question only${question?.capture_conflict ? " · Conflict — fills nothing" : ""}`,
          aside: `Revision ${capture.revision} · ${formatDate(capture.updated_at)}`,
        };
      })}
      onOpen={onOpen}
      hasNextPage={query.hasNextPage}
      isFetchingNextPage={query.isFetchingNextPage}
      onLoadMore={() => void query.fetchNextPage()}
    />
  );
}
