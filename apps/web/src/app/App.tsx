import { useAppShortcuts } from "./useAppShortcuts";
import { copy } from "./copy";
import { useJobsRefresh } from "../features/jobs/useJobsRefresh";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { AddJobDialog } from "../features/jobs/AddJobDialog";
import { NotificationBell } from "../features/notifications/NotificationBell";
import { ExtensionSettingsDialog } from "../features/extension-settings/ExtensionSettingsDialog";
import { AboutDialog } from "./AboutDialog";
import { BlockedCompaniesDialog } from "../features/blocked-companies/BlockedCompaniesDialog";
import { Board } from "../features/jobs/Board";
import { DetailDrawer } from "../features/jobs/detail/DetailDrawer";
import { FormFillNav } from "./FormFillNav";
import { HeaderMenu } from "./HeaderMenu";
import { IconButton } from "../shared/ui/IconButton";
import { NoResults } from "../features/jobs/NoResults";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { SortMenu } from "../features/jobs/SortMenu";
import { ViewBar } from "../features/jobs/ViewBar";
import { api } from "../features/jobs/client";
import { useBlockedCompanies } from "../features/blocked-companies/queries";
import { useFormFillReviewPresence } from "../features/form-fill/queries";
import { useJobEvents } from "../features/jobs/queries";
import { FormFillWorkspace } from "../features/form-fill/FormFillWorkspace";
import { canLeaveFormFill } from "../features/form-fill/draftGuard";
import {
  countAttention,
  filterJobs,
  type ListingAvailabilityFilter,
} from "../features/jobs/jobFilters";
import { persistPreference, usePersistentBoolean } from "../shared/persist";
import {
  DEFAULT_SORT_ORDER,
  SORT_ORDER_VALUES,
  sortJobs,
  type SortOrder,
} from "../features/jobs/jobSort";
import { readPersistentChoice, usePersistentChoice } from "../shared/usePersistentChoice";
import { initialWorkspace } from "./workspace";
import { useTheme } from "../shared/theme";
import { toast } from "../shared/toast";
import { useBuildCheck } from "./useBuildCheck";
import { reloadBuild } from "./reloadBuild";
import type { EventItem } from "@job-tracker/shared/api";

export default function App() {
  const buildCheck = useBuildCheck();
  const { query: jobsQuery, refreshing, refreshJobs } = useJobsRefresh();
  const { data: jobs, isLoading, isFetching, isError, error } = jobsQuery;

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
  const [listingAvailability, setListingAvailability] =
    usePersistentChoice<ListingAvailabilityFilter>(
      "jt.listingAvailability",
      ["all", "closed", "unavailable"],
      "all",
    );
  const [sortOrder, setSortOrder] = usePersistentChoice(
    "jt.sortOrder",
    SORT_ORDER_VALUES,
    DEFAULT_SORT_ORDER,
  );
  const [showHelp, setShowHelp] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showExtensionSettings, setShowExtensionSettings] = useState(
    () => new URLSearchParams(window.location.search).get("settings") === "extension",
  );
  const closeExtensionSettings = useCallback(() => {
    setShowExtensionSettings(false);
    const url = new URL(window.location.href);
    if (url.searchParams.get("settings") === "extension") {
      url.searchParams.delete("settings");
      window.history.replaceState(null, "", url);
    }
  }, []);
  const [showAdd, setShowAdd] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

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
        "listing_availability",
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
      .catch(() => active && toast.info(copy.app.isnTCapturedYet(platform, platformId)));
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
    const availability = params.get("listing_availability");
    if (availability === "all" || availability === "closed" || availability === "unavailable")
      setListingAvailability(availability);
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
    if (listingAvailability !== "all")
      url.searchParams.set("listing_availability", listingAvailability);
    else url.searchParams.delete("listing_availability");
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
    listingAvailability,
  ]);

  useAppShortcuts({
    selectedJobId,
    showHelp,
    showAbout,
    showExtensionSettings,
    showAdd,
    showBlocked,
    cycleTheme,
    showStarred,
    setShowStarred,
    showAttention,
    setShowAttention,
    hideHidden,
    setHideHidden,
    hideBlocked,
    setHideBlocked,
    easyApplyOnly,
    setEasyApplyOnly,
    view,
    searchRef,
    setShowHelp,
    setShowAdd,
  });

  // Filters operate on the complete loaded job set without refetching.
  const attentionCount = useMemo(() => countAttention(jobs ?? []), [jobs]);

  const filtered = useMemo(
    () =>
      filterJobs(
        jobs ?? [],
        {
          search,
          hideHidden,
          showStarred,
          showAttention,
          hideBlocked,
          easyApplyOnly,
          listingAvailability,
        },
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
      listingAvailability,
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
    setListingAvailability("all");
  }, []);

  const noResults = jobs !== undefined && jobs.length > 0 && filtered.length === 0;

  return (
    <div className="flex h-full flex-col">
      <header className="relative z-20 flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-3 sm:gap-4">
        <h1 className="shrink-0 text-sm font-semibold text-ink sm:text-base">
          {copy.app.jobTracker}
        </h1>
        <div
          ref={view === "form-fill" ? setFormFillActionHost : undefined}
          className="hidden shrink-0 items-center gap-1 sm:flex"
        >
          {view === "jobs" && (
            <>
              <IconButton
                size="field"
                label={copy.app.addAJobN}
                onClick={() => setShowAdd(true)}
                className="shrink-0 text-ink-muted hover:text-ink"
              >
                <Plus size={16} />
              </IconButton>
              <IconButton
                size="field"
                label={refreshing ? copy.appMessages.refreshingData : copy.appMessages.refreshData}
                aria-busy={refreshing}
                disabled={refreshing}
                onClick={() => {
                  void refreshJobs();
                }}
                className="shrink-0 text-ink-muted hover:text-ink"
              >
                <RefreshCw
                  size={16}
                  className={
                    isFetching || refreshing ? "animate-spin motion-reduce:animate-none" : ""
                  }
                />
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
                listingAvailability={listingAvailability}
                onListingAvailabilityChange={setListingAvailability}
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
        <NotificationBell
          onOpenJob={(id) => {
            changeView("jobs");
            setSelectedJobId(id);
          }}
        />
        <HeaderMenu
          onOpenExtensionSettings={() => setShowExtensionSettings(true)}
          refreshing={refreshing}
          view={view}
          hasReview={reviewPresence.hasReview}
          onAdd={view === "jobs" ? () => setShowAdd(true) : formFillCreate}
          onRefresh={
            view === "jobs"
              ? () => {
                  void refreshJobs();
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
            {isLoading && <div className="p-6 text-sm text-ink-muted">{copy.app.loadingJobs}</div>}
            {isError && (
              <div className="p-6 text-sm text-red-600 dark:text-red-400">
                {copy.app.apiUnavailable(String(error))}
              </div>
            )}
            {noResults && (
              <NoResults
                listingAvailability={listingAvailability}
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

      {showExtensionSettings && <ExtensionSettingsDialog onClose={closeExtensionSettings} />}
      {showBlocked && <BlockedCompaniesDialog onClose={() => setShowBlocked(false)} />}
    </div>
  );
}
