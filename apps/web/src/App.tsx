import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { AddJobDialog } from "./components/AddJobDialog";
import { BlockedCompaniesDialog } from "./components/BlockedCompaniesDialog";
import { Board } from "./components/Board";
import { DetailDrawer } from "./components/detail/DetailDrawer";
import { FormFillNav } from "./components/FormFillNav";
import { HeaderMenu } from "./components/HeaderMenu";
import { IconButton } from "./components/IconButton";
import { NoResults } from "./components/NoResults";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { SortMenu } from "./components/SortMenu";
import { ViewBar } from "./components/ViewBar";
import { api } from "./api/client";
import { useFormFillReviewPresence, useJobEvents, useJobs } from "./hooks";
import { FormFillWorkspace } from "./form-fill/FormFillWorkspace";
import { countAttention, filterJobs } from "./lib/jobFilters";
import { usePersistentBoolean } from "./lib/persist";
import { DEFAULT_SORT_ORDER, SORT_ORDER_VALUES, sortJobs, type SortOrder } from "./lib/jobSort";
import { usePersistentChoice } from "./lib/usePersistentChoice";
import { useTheme } from "./lib/theme";
import { toast } from "./lib/toast";
import type { EventItem } from "@job-tracker/shared/api";

// True when a keystroke lands in an editable field, so global letter/`/` shortcuts
// yield to typing instead of hijacking it.
function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable
  );
}

export default function App() {
  const { data: jobs, isLoading, isFetching, isError, error, refetch } = useJobs();
  const events = useJobEvents();
  const { pref: themePref, cycle: cycleTheme } = useTheme();
  const reviewPresence = useFormFillReviewPresence();

  const [view, setView] = useState<"jobs" | "form-fill">(() =>
    new URLSearchParams(window.location.search).get("view") === "form-fill" ? "form-fill" : "jobs",
  );
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [search, setSearch] = useState(() =>
    view === "jobs" ? (new URLSearchParams(window.location.search).get("q") ?? "") : "",
  );
  const [hideHidden, setHideHidden] = usePersistentBoolean("jt.hideHidden", false);
  const [showStarred, setShowStarred] = usePersistentBoolean("jt.showStarred", false);
  const [showAttention, setShowAttention] = usePersistentBoolean("jt.showAttention", false);
  const [sortOrder, setSortOrder] = usePersistentChoice(
    "jt.sortOrder",
    SORT_ORDER_VALUES,
    DEFAULT_SORT_ORDER,
  );
  const [showHelp, setShowHelp] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // The last card that held focus, so re-entering the board returns you there
  // rather than always to the first card.
  const lastCardIdRef = useRef<string | null>(null);

  useEffect(() => {
    const onPopState = () =>
      setView(
        new URLSearchParams(window.location.search).get("view") === "form-fill"
          ? "form-fill"
          : "jobs",
      );
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const changeView = useCallback((next: "jobs" | "form-fill") => {
    setView(next);
    setSelectedJobId(null);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    if (next === "form-fill") {
      url.searchParams.set("section", url.searchParams.get("section") ?? "answers");
      for (const key of [
        "job",
        "platform",
        "platform_id",
        "q",
        "visible",
        "starred",
        "attention",
        "sort",
      ])
        url.searchParams.delete(key);
    } else {
      for (const key of ["section", "type", "answer", "capture", "question"])
        url.searchParams.delete(key);
    }
    window.history.pushState(null, "", url);
  }, []);

  // Stable across renders, since `mutate` is referentially stable, so
  // React.memo(JobCard) holds and a board mutation re-renders only the changed card.
  const { mutate: mutateEvent } = events;
  const onEvent = useCallback(
    (jobId: string, evts: EventItem[]) => mutateEvent({ jobId, events: evts }),
    [mutateEvent],
  );

  // Deep-link on load: `?job=<id>` opens directly, while the extension's stable
  // `?platform=&platform_id=` link resolves through the listings lookup first. A 404
  // means the posting isn't captured yet.
  useEffect(() => {
    if (view !== "jobs") return;
    const params = new URLSearchParams(window.location.search);
    const job = params.get("job");
    if (job) {
      setSelectedJobId(job);
      return;
    }
    const platform = params.get("platform");
    const platformId = params.get("platform_id");
    if (!platform || !platformId) return;
    let active = true;
    api
      .lookupListing(platform, platformId)
      .then((r) => active && setSelectedJobId(r.job_id))
      .catch(() => active && toast.info(`“${platform}:${platformId}” isn’t captured yet.`));
    return () => {
      active = false;
    };
  }, [view]);

  // Filter and sort toggles read from the URL on load, so a shared link overrides
  // whatever was last persisted locally. Absent params leave the localStorage default.
  useEffect(() => {
    if (view !== "jobs") return;
    const params = new URLSearchParams(window.location.search);
    const visible = params.get("visible");
    const starred = params.get("starred");
    const attention = params.get("attention");
    const sort = params.get("sort");
    if (visible != null) setHideHidden(visible === "true");
    if (starred != null) setShowStarred(starred === "true");
    if (attention != null) setShowAttention(attention === "true");
    if (sort && (SORT_ORDER_VALUES as string[]).includes(sort)) {
      setSortOrder(sort as SortOrder);
    }
  }, [view]);

  // Reflect the open job, search, and active filters in the URL so a refresh,
  // bookmark, or share keeps them, and the one-time natural-key params normalize to a
  // clean `?job=<id>`.
  useEffect(() => {
    if (view !== "jobs") return;
    const url = new URL(window.location.href);
    if (selectedJobId) url.searchParams.set("job", selectedJobId);
    else url.searchParams.delete("job");
    url.searchParams.delete("platform");
    url.searchParams.delete("platform_id");
    if (search) url.searchParams.set("q", search);
    else url.searchParams.delete("q");
    if (hideHidden) url.searchParams.set("visible", "true");
    else url.searchParams.delete("visible");
    if (showStarred) url.searchParams.set("starred", "true");
    else url.searchParams.delete("starred");
    if (showAttention) url.searchParams.set("attention", "true");
    else url.searchParams.delete("attention");
    if (sortOrder !== DEFAULT_SORT_ORDER) url.searchParams.set("sort", sortOrder);
    else url.searchParams.delete("sort");
    window.history.replaceState(null, "", url);
  }, [view, selectedJobId, search, hideHidden, showStarred, showAttention, sortOrder]);

  // Global shortcuts: `/` jumps to search, `?` opens the help sheet. Suppressed while
  // typing, so they don't eat input, and while a modal owns the screen — the drawer
  // and help sheet handle their own keys, and `/` mustn't focus a search box hidden
  // behind them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (view !== "jobs") return;
      if (isTypingTarget(e.target) || selectedJobId || showHelp || showAdd || showBlocked) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === "?") {
        e.preventDefault();
        setShowHelp(true);
      } else if (e.key === "n") {
        e.preventDefault();
        setShowAdd(true);
      } else if (e.key === "t") {
        e.preventDefault();
        cycleTheme();
      } else if (e.key === "S") {
        e.preventDefault();
        setShowStarred(!showStarred);
      } else if (e.key === "A") {
        e.preventDefault();
        setShowAttention(!showAttention);
      } else if (e.key === "H") {
        e.preventDefault();
        setHideHidden(!hideHidden);
      } else if (e.key.startsWith("Arrow")) {
        // Enter the board: with nothing else focused, an arrow drops onto the last
        // card you were on, or the first on a cold start, from where each card's own
        // handler walks the grid. Gated on focus being truly idle (on <body>), so
        // arrows are never stolen from another control.
        const active = document.activeElement;
        if (active && active !== document.body) return;
        const last =
          lastCardIdRef.current &&
          document.querySelector<HTMLElement>(
            `[data-card-id="${CSS.escape(lastCardIdRef.current)}"]`,
          );
        const target = last ?? document.querySelector<HTMLElement>("[data-card-id]");
        if (target) {
          e.preventDefault();
          target.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    selectedJobId,
    showHelp,
    showAdd,
    showBlocked,
    cycleTheme,
    showStarred,
    showAttention,
    hideHidden,
    view,
  ]);

  // Remember which card last held focus, feeding the "return to the board" jump.
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const card = (e.target as HTMLElement | null)?.closest?.("[data-card-id]");
      if (card) lastCardIdRef.current = card.getAttribute("data-card-id");
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  // Search and the hidden toggle apply client-side over the single loaded set, so
  // flipping them is instant and never refetches (see useJobs).
  const attentionCount = useMemo(() => countAttention(jobs ?? []), [jobs]);

  const filtered = useMemo(
    () => filterJobs(jobs ?? [], { search, hideHidden, showStarred, showAttention }),
    [jobs, search, hideHidden, showStarred, showAttention],
  );

  // Ordering is a view preference over the already-filtered complete job set.
  // Board's per-status filters preserve this order within every column.
  const ordered = useMemo(() => sortJobs(filtered, sortOrder), [filtered, sortOrder]);

  // Shared by the ViewBar's clear-all ✕ and the zero-results panel's button.
  const clearFilters = useCallback(() => {
    setSearch("");
    setShowStarred(false);
    setShowAttention(false);
    setHideHidden(false);
  }, []);

  const noResults = jobs !== undefined && jobs.length > 0 && filtered.length === 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-line px-4 py-3">
        <h1 className="text-base font-semibold text-ink">Job Tracker</h1>
        <FormFillNav view={view} hasReview={reviewPresence.hasReview} onChange={changeView} />
        {view === "jobs" && (
          <>
            <IconButton
              label="Refresh data"
              onClick={() => refetch()}
              className="text-ink-muted hover:text-ink"
            >
              <RefreshCw size={16} className={isFetching ? "animate-spin" : ""} />
            </IconButton>
            <ViewBar
              search={search}
              onSearchChange={setSearch}
              searchRef={searchRef}
              hideHidden={hideHidden}
              onToggleHidden={() => setHideHidden(!hideHidden)}
              showStarred={showStarred}
              onToggleStarred={() => setShowStarred(!showStarred)}
              showAttention={showAttention}
              onToggleAttention={() => setShowAttention(!showAttention)}
              attentionCount={attentionCount}
              shownCount={filtered.length}
              totalCount={jobs?.length ?? 0}
              onClearAll={clearFilters}
            />
            <SortMenu value={sortOrder} onChange={setSortOrder} />
            <IconButton label="Add a job (n)" onClick={() => setShowAdd(true)}>
              <Plus size={16} />
            </IconButton>
          </>
        )}
        <HeaderMenu
          onOpenBlocked={() => setShowBlocked(true)}
          onOpenHelp={() => setShowHelp(true)}
          themePref={themePref}
          cycleTheme={cycleTheme}
        />
      </header>

      <main className="min-h-0 flex-1">
        {view === "form-fill" ? (
          <FormFillWorkspace />
        ) : (
          <>
            {isLoading && <div className="p-6 text-sm text-ink-muted">Loading jobs…</div>}
            {isError && (
              <div className="p-6 text-sm text-red-600 dark:text-red-400">
                Couldn’t reach the API ({String(error)}). Is the server running on :3456?
              </div>
            )}
            {noResults && (
              <NoResults
                query={search}
                showStarred={showStarred}
                showAttention={showAttention}
                hideHidden={hideHidden}
                onClear={clearFilters}
              />
            )}
            {jobs && !noResults && (
              <Board jobs={ordered} onOpen={setSelectedJobId} onEvent={onEvent} />
            )}
          </>
        )}
      </main>

      {view === "jobs" && selectedJobId && (
        <DetailDrawer
          jobId={selectedJobId}
          attention={jobs?.find((job) => job.id === selectedJobId)?.attention ?? null}
          onClose={() => setSelectedJobId(null)}
          onEvent={onEvent}
          onNavigate={setSelectedJobId}
        />
      )}

      {showAdd && (
        <AddJobDialog
          onClose={() => setShowAdd(false)}
          onCreated={(jobId) => {
            setShowAdd(false);
            setSelectedJobId(jobId);
          }}
        />
      )}

      {showHelp && <ShortcutsDialog onClose={() => setShowHelp(false)} />}

      {showBlocked && <BlockedCompaniesDialog onClose={() => setShowBlocked(false)} />}
    </div>
  );
}
