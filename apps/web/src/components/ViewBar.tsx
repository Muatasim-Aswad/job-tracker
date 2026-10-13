import type { RefObject } from "react";
import { HeaderSearch } from "./HeaderSearch";
import { FilterPopover } from "./FilterPopover";

interface Props {
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
  const filtersApplied = hideHidden || showStarred || showAttention || hideBlocked || easyApplyOnly;
  const narrowed = search.trim().length > 0 || filtersApplied;

  return (
    <>
      <HeaderSearch
        label="Search jobs by title or company"
        placeholder="Search…  ( / )"
        value={search}
        onChange={onSearchChange}
        inputRef={searchRef}
        count={narrowed ? `${shownCount} of ${totalCount}` : totalCount}
        countLabel="Jobs shown (after search + filters) / total loaded"
        active={narrowed}
        onClear={onClearAll}
      />
      <FilterPopover applied={filtersApplied} label="Job filters">
        <div className="space-y-3">
          <p className="text-xs text-ink-muted">Show only</p>
          <FilterOption
            label="Needs attention only"
            checked={showAttention}
            onChange={onToggleAttention}
            shortcut="A"
            count={attentionCount}
          />
          <FilterOption
            label="Starred only"
            checked={showStarred}
            onChange={onToggleStarred}
            shortcut="S"
          />
          <FilterOption
            label="Easy Apply only"
            checked={easyApplyOnly}
            onChange={onToggleEasyApply}
            shortcut="E"
          />
        </div>
        <div className="space-y-3 border-t border-line pt-3">
          <p className="text-xs text-ink-muted">Visibility</p>
          <FilterOption
            label="Hide hidden jobs"
            checked={hideHidden}
            onChange={onToggleHidden}
            shortcut="H"
          />
          <FilterOption
            label="Hide blocked companies"
            checked={hideBlocked}
            onChange={onToggleBlocked}
            shortcut="B"
          />
        </div>
      </FilterPopover>
    </>
  );
}
