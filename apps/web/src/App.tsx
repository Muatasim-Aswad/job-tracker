import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { AddJobDialog } from "./components/AddJobDialog";
import { AboutDialog } from "./components/AboutDialog";
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
import { useBlockedCompanies, useFormFillReviewPresence, useJobEvents, useJobs } from "./hooks";
import { FormFillWorkspace } from "./form-fill/FormFillWorkspace";
import { canLeaveFormFill } from "./form-fill/draftGuard";
import { countAttention, filterJobs } from "./lib/jobFilters";
import { persistPreference, usePersistentBoolean } from "./lib/persist";
import { DEFAULT_SORT_ORDER, SORT_ORDER_VALUES, sortJobs, type SortOrder } from "./lib/jobSort";
import { readPersistentChoice, usePersistentChoice } from "./lib/usePersistentChoice";
import { initialWorkspace } from "./lib/workspace";
import { useTheme } from "./lib/theme";
import { toast } from "./lib/toast";
import { useBuildCheck } from "./lib/useBuildCheck";
import { reloadBuild } from "./lib/reloadBuild";
import type { EventItem } from "@job-tracker/shared/api";

// Global shortcuts yield to editable controls.
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
  const buildCheck = useBuildCheck();
  const { data: jobs, isLoading, isFetching, isError, error, refetch } = useJobs();
  const events = useJobEvents();
  const { pref: themePref, cycle: cycleTheme } = useTheme();
  const reviewPresence = useFormFillReviewPresence();
  const { data: blockedCompanies } = useBlockedCompanies();

  const [view, setView] = useState<"jobs" | "form-fill">(() =>
    initialWorkspace(
      new URLSearchParams(window.location.search),
      readPersistentChoice("jt.workspace", ["jobs", "form-fill"], "jobs"),
    ),
  );
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [formFillCreate, setFormFillCreate] = useState<(() => void) | null>(null);
  const registerFormFillCreate = useCallback((action: (() => void) | null) => {
    setFormFillCreate(() => action);
  }, []);
  const [formFillActionHost, setFormFillActionHost] = useState<HTMLDivElement | null>(null);
  const [formFillToolbarHost, setFormFillToolbarHost] = useState<HTMLDivElement | null>(null);
  const [search, setSearch] = useState(() =>
    view === "jobs" ? (new URLSearchParams(window.location.search).get("q") ?? "") : "",
  );
  const [hideHidden, setHideHidden] = usePersistentBoolean("jt.hideHidden", false);
  const [showStarred, setShowStarred] = usePersistentBoolean("jt.showStarred", false);
  const [showAttention, setShowAttention] = usePersistentBoolean("jt.showAttention", false);
  const [hideBlocked, setHideBlocked] = usePersistentBoolean("jt.hideBlocked", false);
  const [easyApplyOnly, setEasyApplyOnly] = usePersistentBoolean("jt.easyApplyOnly", false);
  const [sortOrder, setSortOrder] = usePersistentChoice(
    "jt.sortOrder",
    SORT_ORDER_VALUES,
    DEFAULT_SORT_ORDER,
  );
  const [showHelp, setShowHelp] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // Restore the last focused card when re-entering the board.
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

  useEffect(() => persistPreference("jt.workspace", view), [view]);

  const changeView = useCallback((next: "jobs" | "form-fill") => {
    if (!canLeaveFormFill()) return;
    setView(next);
    setSelectedJobId(null);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    if (next === "form-fill") {
      url.searchParams.set(
        "section",
        url.searchParams.get("section") ??
          readPersistentChoice("jt.formFill.section", ["review", "answers"], "review"),
      );
      for (const key of [
        "job",
        "platform",
        "platform_id",
        "q",
        "visible",
        "starred",
        "attention",
        "unblocked",
        "easy_apply",
        "sort",
      ])
        url.searchParams.delete(key);
    } else {
      for (const key of ["section", "type", "answer", "capture", "question"])
        url.searchParams.delete(key);
    }
    window.history.pushState(null, "", url);
  }, []);

  // Stable callbacks preserve JobCard memoization.
  const { mutate: mutateEvent } = events;
  const onEvent = useCallback(
    (jobId: string, evts: EventItem[]) => mutateEvent({ jobId, events: evts }),
    [mutateEvent],
  );

  // Resolve extension natural-key links to stored job IDs; 404 means uncaptured.
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

  // Explicit URL state overrides local preferences; absent parameters retain them.
  useEffect(() => {
    if (view !== "jobs") return;
    const params = new URLSearchParams(window.location.search);
    const visible = params.get("visible");
    const starred = params.get("starred");
    const attention = params.get("attention");
    const unblocked = params.get("unblocked");
    const easyApply = params.get("easy_apply");
    const sort = params.get("sort");
    if (visible != null) setHideHidden(visible === "true");
    if (starred != null) setShowStarred(starred === "true");
    if (attention != null) setShowAttention(attention === "true");
    if (unblocked != null) setHideBlocked(unblocked === "true");
    if (easyApply != null) setEasyApplyOnly(easyApply === "true");
    if (sort && (SORT_ORDER_VALUES as string[]).includes(sort)) {
      setSortOrder(sort as SortOrder);
    }
  }, [view]);

  // Normalize natural-key links to job IDs and retain job/filter/search state in the URL.
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
    if (hideBlocked) url.searchParams.set("unblocked", "true");
    else url.searchParams.delete("unblocked");
    if (easyApplyOnly) url.searchParams.set("easy_apply", "true");
    else url.searchParams.delete("easy_apply");
    if (sortOrder !== DEFAULT_SORT_ORDER) url.searchParams.set("sort", sortOrder);
    else url.searchParams.delete("sort");
    window.history.replaceState(null, "", url);
  }, [
    view,
    selectedJobId,
    search,
    hideHidden,
    showStarred,
    showAttention,
    hideBlocked,
    easyApplyOnly,
    sortOrder,
  ]);

  // Modal-owned keys and editable controls suppress global shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (view !== "jobs") return;
      if (
        isTypingTarget(e.target) ||
        selectedJobId ||
        showHelp ||
        showAbout ||
        showAdd ||
        showBlocked
      )
        return;
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
      } else if (e.key === "B") {
        e.preventDefault();
        setHideBlocked(!hideBlocked);
      } else if (e.key === "E") {
        e.preventDefault();
        setEasyApplyOnly(!easyApplyOnly);
      } else if (e.key.startsWith("Arrow")) {
        // Enter the board only from idle body focus; preserve arrows in other controls.
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
    showAbout,
    showAdd,
    showBlocked,
    cycleTheme,
    showStarred,
    showAttention,
    hideHidden,
    hideBlocked,
    easyApplyOnly,
    view,
  ]);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const card = (e.target as HTMLElement | null)?.closest?.("[data-card-id]");
      if (card) lastCardIdRef.current = card.getAttribute("data-card-id");
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  // Filters operate on the complete loaded job set without refetching.
  const attentionCount = useMemo(() => countAttention(jobs ?? []), [jobs]);

  const filtered = useMemo(
    () =>
      filterJobs(
        jobs ?? [],
        { search, hideHidden, showStarred, showAttention, hideBlocked, easyApplyOnly },
        blockedCompanies,
      ),
    [
      jobs,
      search,
      hideHidden,
      showStarred,
      showAttention,
      hideBlocked,
      easyApplyOnly,
      blockedCompanies,
    ],
  );

  // Column filters preserve the selected client-side order.
  const ordered = useMemo(() => sortJobs(filtered, sortOrder), [filtered, sortOrder]);

  const clearFilters = useCallback(() => {
    setSearch("");
    setShowStarred(false);
    setShowAttention(false);
    setHideHidden(false);
    setHideBlocked(false);
    setEasyApplyOnly(false);
  }, []);

  const noResults = jobs !== undefined && jobs.length > 0 && filtered.length === 0;

  return (
    <div className="flex h-full flex-col">
      <header className="relative z-20 flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:gap-4">
        <h1 className="shrink-0 text-sm font-semibold text-ink sm:text-base">Job Tracker</h1>
        <div
          ref={view === "form-fill" ? setFormFillActionHost : undefined}
          className="hidden shrink-0 items-center gap-1 sm:flex"
        >
          {view === "jobs" && (
            <>
              <IconButton
                size="field"
                label="Add a job (n)"
                onClick={() => setShowAdd(true)}
                className="shrink-0 text-ink-muted hover:text-ink"
              >
                <Plus size={16} />
              </IconButton>
              <IconButton
                size="field"
                label="Refresh data"
                onClick={() => refetch()}
                className="shrink-0 text-ink-muted hover:text-ink"
              >
                <RefreshCw size={16} className={isFetching ? "animate-spin" : ""} />
              </IconButton>
            </>
          )}
        </div>
        <div className="hidden sm:block">
          <FormFillNav view={view} hasReview={reviewPresence.hasReview} onChange={changeView} />
        </div>
        <div
          ref={view === "form-fill" ? setFormFillToolbarHost : undefined}
          className="relative order-last flex min-w-0 basis-full items-center gap-2 lg:order-none lg:ml-auto lg:max-w-[740px] lg:basis-auto lg:flex-1"
        >
          {view === "jobs" && (
            <>
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
                hideBlocked={hideBlocked}
                onToggleBlocked={() => setHideBlocked(!hideBlocked)}
                easyApplyOnly={easyApplyOnly}
                onToggleEasyApply={() => setEasyApplyOnly(!easyApplyOnly)}
                attentionCount={attentionCount}
                shownCount={filtered.length}
                totalCount={jobs?.length ?? 0}
                onClearAll={clearFilters}
              />
              <SortMenu value={sortOrder} onChange={setSortOrder} />
            </>
          )}
        </div>
        <HeaderMenu
          view={view}
          hasReview={reviewPresence.hasReview}
          onAdd={view === "jobs" ? () => setShowAdd(true) : formFillCreate}
          onRefresh={
            view === "jobs"
              ? () => {
                  void refetch();
                }
              : undefined
          }
          onChangeView={changeView}
          onOpenBlocked={() => setShowBlocked(true)}
          onOpenHelp={() => setShowHelp(true)}
          onOpenAbout={() => setShowAbout(true)}
          themePref={themePref}
          cycleTheme={cycleTheme}
        />
      </header>

      <main className={`min-h-0 flex-1 ${view === "form-fill" ? "overflow-y-auto" : ""}`}>
        {view === "form-fill" ? (
          <FormFillWorkspace
            toolbarHost={formFillToolbarHost}
            actionHost={formFillActionHost}
            onCreateReady={registerFormFillCreate}
          />
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
                hideBlocked={hideBlocked}
                easyApplyOnly={easyApplyOnly}
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

      {showAbout && (
        <AboutDialog
          onClose={() => setShowAbout(false)}
          result={buildCheck.result}
          onCheck={buildCheck.check}
          onReload={() => reloadBuild()}
        />
      )}

      {showBlocked && <BlockedCompaniesDialog onClose={() => setShowBlocked(false)} />}
    </div>
  );
}
