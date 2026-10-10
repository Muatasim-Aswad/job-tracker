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
      title="Cleared value history"
      filters={
        <label className="flex-1 text-xs font-normal text-ink-muted">
          <span className="sr-only">Search cleared value history</span>
          <input
            type="search"
            placeholder="Search cleared value history"
            maxLength={256}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm font-normal text-ink"
          />
        </label>
      }
      isLoading={query.isLoading}
      isError={query.isError}
      onRetry={() => void query.refetch()}
      loadingLabel="Loading cleared value history…"
      errorLabel="Couldn’t load cleared value history."
      emptyTitle={q ? "No cleared values match your search." : "No cleared values."}
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
