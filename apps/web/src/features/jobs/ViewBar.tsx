import { copy } from "./copy";
import type { ListingAvailabilityFilter } from "./jobFilters";
import { useId, type RefObject } from "react";
import { HeaderSearch } from "../../shared/ui/HeaderSearch";
import { FilterPopover } from "../../shared/ui/FilterPopover";

interface Props {
  listingAvailability?: ListingAvailabilityFilter;
  onListingAvailabilityChange?: (value: ListingAvailabilityFilter) => void;
  search: string;
  onSearchChange: (value: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  hideHidden: boolean;
  onToggleHidden: () => void;
  showStarred: boolean;
  onToggleStarred: () => void;
  showAttention: boolean;
  onToggleAttention: () => void;
  hideBlocked: boolean;
  onToggleBlocked: () => void;
  easyApplyOnly: boolean;
  onToggleEasyApply: () => void;
  attentionCount: number;
  shownCount: number;
  totalCount: number;
  onClearAll: () => void;
}

function FilterOption({
  label,
  checked,
  onChange,
  shortcut,
  count,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  shortcut: string;
  count?: number;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={onChange}
        className="accent-accent"
      />
      <span className="flex-1">{label}</span>
      {count != null && count > 0 && (
        <span className="rounded-full bg-amber-500/15 px-1.5 text-xs tabular-nums text-amber-700 dark:text-amber-300">
          {count}
        </span>
      )}
      <kbd aria-hidden="true" className="text-xs text-ink-muted">
        {shortcut}
      </kbd>
    </label>
  );
}

export function ViewBar({
  listingAvailability = "all",
  onListingAvailabilityChange,
  search,
  onSearchChange,
  searchRef,
  hideHidden,
  onToggleHidden,
  showStarred,
  onToggleStarred,
  showAttention,
  onToggleAttention,
  hideBlocked,
  onToggleBlocked,
  easyApplyOnly,
  onToggleEasyApply,
  attentionCount,
  shownCount,
  totalCount,
  onClearAll,
}: Props) {
  const listingControlId = useId();
  const filtersApplied =
    hideHidden ||
    showStarred ||
    showAttention ||
    hideBlocked ||
    easyApplyOnly ||
    listingAvailability !== "all";
  const narrowed = search.trim().length > 0 || filtersApplied;

  return (
    <>
      <HeaderSearch
        label={copy.viewBar.searchJobsByTitleOrCompany}
        placeholder={copy.viewBar.search}
        value={search}
        onChange={onSearchChange}
        inputRef={searchRef}
        count={narrowed ? `${shownCount} of ${totalCount}` : totalCount}
        countLabel={copy.viewBar.jobsShownAfterSearchFiltersTotalLoaded}
        active={narrowed}
        onClear={onClearAll}
      />
      <FilterPopover applied={filtersApplied} label={copy.viewBar.jobFilters}>
        <div className="space-y-3">
          <p className="text-xs text-ink-muted">{copy.viewBar.showOnly}</p>
          <FilterOption
            label={copy.viewBar.needsAttention}
            checked={showAttention}
            onChange={onToggleAttention}
            shortcut="A"
            count={attentionCount}
          />
          <FilterOption
            label={copy.viewBar.starred}
            checked={showStarred}
            onChange={onToggleStarred}
            shortcut="S"
          />
          <FilterOption
            label={copy.viewBar.easyApply}
            checked={easyApplyOnly}
            onChange={onToggleEasyApply}
            shortcut="E"
          />
        </div>
        <div
          role="group"
          aria-label={copy.viewBar.listing}
          className="flex items-center gap-3 border-t border-line pt-3"
        >
          <label htmlFor={listingControlId} className="shrink-0">
            {copy.viewBar.listing2}
          </label>
          <select
            id={listingControlId}
            aria-label={copy.viewBar.listing}
            value={listingAvailability}
            onChange={(event) =>
              onListingAvailabilityChange?.(event.target.value as ListingAvailabilityFilter)
            }
            className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1.5 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="all">{copy.viewBar.all}</option>
            <option value="unavailable">{copy.viewBar.unavailable}</option>
            <option value="closed">{copy.viewBar.closed}</option>
          </select>
        </div>
        <div className="space-y-3 border-t border-line pt-3">
          <p className="text-xs text-ink-muted">{copy.viewBar.visibility}</p>
          <FilterOption
            label={copy.viewBar.hideHiddenJobs}
            checked={hideHidden}
            onChange={onToggleHidden}
            shortcut="H"
          />
          <FilterOption
            label={copy.viewBar.hideBlockedCompanies}
            checked={hideBlocked}
            onChange={onToggleBlocked}
            shortcut="B"
          />
        </div>
      </FilterPopover>
    </>
  );
}
