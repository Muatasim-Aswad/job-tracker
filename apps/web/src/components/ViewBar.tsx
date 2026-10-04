import { Ban, Clock, Eye, Star, X, Zap } from "lucide-react";
import type { RefObject } from "react";

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

const TOGGLE_BASE =
  "flex items-center justify-center px-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500";
const TOGGLE_OFF = "text-ink-muted hover:text-ink";
const TOGGLE_ON = "bg-sunken text-ink";

// The centerpiece of the header: search, the shown-count, and the attention/flag
// toggles fused into one bordered container, because together they're one thing — the
// current view. At rest it shows a bare total; anything that *narrows* the view
// (search text, attention-only, hidden or blocked exclusion, starred-only, Easy
// Apply-only) expands the count to
// "x of y" with a clear-all ✕ and rings the whole bar in --accent.
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
  const narrowed =
    search.trim().length > 0 ||
    hideHidden ||
    showStarred ||
    showAttention ||
    hideBlocked ||
    easyApplyOnly;

  return (
    <div
      className={`ml-auto flex min-h-[2.125rem] w-full max-w-[540px] items-stretch rounded-lg border bg-surface ${
        narrowed ? "border-accent ring-2 ring-accent/20" : "border-line"
      }`}
    >
      <input
        ref={searchRef}
        type="search"
        aria-label="Search jobs by title or company"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onSearchChange("");
            e.currentTarget.blur();
          }
        }}
        placeholder="Search…  ( / )"
        className="min-w-0 flex-1 rounded-l-lg bg-transparent px-3 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500"
      />
      <div
        className="flex items-center gap-1.5 border-l border-line px-2 text-xs tabular-nums text-ink-muted"
        title="Jobs shown (after search + toggles) / total loaded"
      >
        {narrowed ? (
          <>
            <span>
              {shownCount} of {totalCount}
            </span>
            <button
              type="button"
              aria-label="Clear filters"
              title="Clear filters"
              onClick={onClearAll}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 pointer-coarse:h-9 pointer-coarse:w-9"
            >
              <X size={12} />
            </button>
          </>
        ) : (
          <span>{totalCount}</span>
        )}
      </div>
      <button
        type="button"
        aria-label={showAttention ? "Stop filtering by attention" : "Show jobs needing attention"}
        aria-pressed={showAttention}
        title={showAttention ? "Show all jobs (A)" : "Show jobs needing attention (A)"}
        onClick={onToggleAttention}
        className={`${TOGGLE_BASE} relative border-l border-line ${
          showAttention
            ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
            : attentionCount > 0
              ? "text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
              : TOGGLE_OFF
        }`}
      >
        <Clock size={16} />
        {attentionCount > 0 && (
          <span className="ml-1 min-w-3.5 rounded-full bg-amber-500/15 px-1 text-center text-micro font-semibold leading-3.5 tabular-nums">
            {attentionCount}
          </span>
        )}
      </button>
      <button
        type="button"
        aria-label={hideHidden ? "Include hidden" : "Only visible"}
        aria-pressed={hideHidden}
        title={hideHidden ? "Include hidden (H)" : "Only visible (H)"}
        onClick={onToggleHidden}
        className={`${TOGGLE_BASE} border-l border-line ${hideHidden ? TOGGLE_ON : TOGGLE_OFF}`}
      >
        <Eye size={16} />
      </button>
      <button
        type="button"
        aria-label={showStarred ? "Show all jobs" : "Show starred only"}
        aria-pressed={showStarred}
        title={showStarred ? "Show all jobs (S)" : "Show starred only (S)"}
        onClick={onToggleStarred}
        className={`${TOGGLE_BASE} border-l border-line ${showStarred ? TOGGLE_ON : TOGGLE_OFF}`}
      >
        <Star size={16} />
      </button>
      <button
        type="button"
        aria-label={hideBlocked ? "Include blocked companies" : "Hide blocked companies"}
        aria-pressed={hideBlocked}
        title={hideBlocked ? "Include blocked companies (B)" : "Hide blocked companies (B)"}
        onClick={onToggleBlocked}
        className={`${TOGGLE_BASE} border-l border-line ${hideBlocked ? TOGGLE_ON : TOGGLE_OFF}`}
      >
        <Ban size={16} />
      </button>
      <button
        type="button"
        aria-label={easyApplyOnly ? "Show all apply types" : "Show Easy Apply only"}
        aria-pressed={easyApplyOnly}
        title={easyApplyOnly ? "Show all apply types (E)" : "Show Easy Apply only (E)"}
        onClick={onToggleEasyApply}
        className={`${TOGGLE_BASE} rounded-r-lg border-l border-line ${
          easyApplyOnly ? TOGGLE_ON : TOGGLE_OFF
        }`}
      >
        <Zap size={16} />
      </button>
    </div>
  );
}
