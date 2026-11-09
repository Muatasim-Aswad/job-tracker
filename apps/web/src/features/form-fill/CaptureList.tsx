import { copy } from "./copy";
import { useDeferredValue, useState } from "react";
import { useFormFillCaptures } from "./queries";
import { SOURCE_LABEL } from "./copy";
import { ReviewList } from "./ReviewList";

interface Props {
  onOpen: (captureId: string) => void;
}

export function CaptureList({ onOpen }: Props) {
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const query = useFormFillCaptures({ status: "ignored", q: q || undefined, limit: 30 });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <ReviewList
      titleId="captures-title"
      title={copy.captureList.clearedValueHistory}
      filters={
        <label className="flex-1 text-xs font-normal text-ink-muted">
          <span className="sr-only">{copy.captureList.searchClearedValueHistory}</span>
          <input
            type="search"
            placeholder={copy.captureList.searchClearedValueHistory}
            maxLength={256}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm font-normal text-ink"
          />
        </label>
      }
      isLoading={query.isLoading}
      isError={query.isError && !query.data}
      onRetry={() => void query.refetch()}
      loadingLabel={copy.captureList.loadingClearedValueHistory}
      errorLabel={copy.captureList.couldnTLoadClearedValueHistory}
      emptyTitle={
        q ? copy.captureList.noClearedValuesMatchYourSearch : copy.captureList.noClearedValues
      }
      emptyBody={copy.captureList.valuesYouDismissAppearHereWithTheirQuestionAnd}
      rows={items.map((capture) => ({
        id: capture.id,
        title: capture.question_label,
        meta: SOURCE_LABEL[capture.source],
        badge: copy.captureList.valueCleared,
        aside: copy.captureList.viewQuestion,
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
