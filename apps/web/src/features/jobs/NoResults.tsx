import { copy } from "./copy";
import type { ListingAvailabilityFilter } from "./jobFilters";
interface Props {
  listingAvailability?: ListingAvailabilityFilter;
  query: string;
  showStarred: boolean;
  showAttention: boolean;
  hideHidden: boolean;
  hideBlocked: boolean;
  easyApplyOnly: boolean;
  onClear: () => void;
}

// Filtered-out jobs differ from an empty account, which App handles separately.
export function NoResults({
  listingAvailability = "all",
  query,
  showStarred,
  showAttention,
  hideHidden,
  hideBlocked,
  easyApplyOnly,
  onClear,
}: Props) {
  const q = query.trim();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-ink-muted">
      <p>
        {q && showStarred && showAttention
          ? `No jobs match “${q}” among starred jobs needing attention.`
          : q && showAttention
            ? `No jobs needing attention match “${q}”.`
            : q && showStarred
              ? `No jobs match “${q}” among starred.`
              : q
                ? `No jobs match “${q}”.`
                : showStarred && showAttention
                  ? copy.noResultsMessages.noStarredJobsNeedAttention
                  : showAttention
                    ? copy.noResultsMessages.noJobsNeedAttention
                    : showStarred
                      ? copy.noResultsMessages.noStarredJobsMatch
                      : listingAvailability !== "all"
                        ? `No jobs with ${listingAvailability} listings match.`
                        : easyApplyOnly
                          ? copy.noResultsMessages.noEasyApplyJobsMatch
                          : hideBlocked
                            ? copy.noResultsMessages.noJobsFromUnblockedCompaniesMatch
                            : hideHidden
                              ? copy.noResultsMessages.noNonHiddenJobsMatch
                              : copy.noResultsMessages.noJobsMatch}
      </p>
      <button
        type="button"
        onClick={onClear}
        className="rounded-lg border border-line bg-surface px-3 py-1.5 text-prose font-semibold text-ink transition-colors hover:border-line-strong hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
      >
        {copy.noResults.clearFilters}
      </button>
    </div>
  );
}
