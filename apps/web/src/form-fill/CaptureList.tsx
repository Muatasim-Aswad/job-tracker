import { useDeferredValue, useState } from "react";
import { useFormFillCaptures } from "../hooks";
import { SOURCE_LABEL } from "./model";
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
      title="Dismissed remembered values"
      filters={
        <label className="flex-1 text-sm font-medium text-ink">
          Search dismissed values
          <input
            type="search"
            maxLength={256}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2"
          />
        </label>
      }
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => void query.refetch()}
      loadingLabel="Loading dismissed values…"
      errorLabel="Couldn’t load dismissed values."
      emptyTitle={q ? "No dismissed values match your search." : "No dismissed values."}
      emptyBody="Values you dismiss appear here with their question and activity history."
      rows={items.map((capture) => ({
        id: capture.id,
        title: capture.question_label,
        meta: SOURCE_LABEL[capture.source],
        badge: "Value cleared",
        aside: "View question",
      }))}
      onOpen={onOpen}
      hasNextPage={query.hasNextPage}
      isFetchingNextPage={query.isFetchingNextPage}
      onLoadMore={() => void query.fetchNextPage()}
    />
  );
}
