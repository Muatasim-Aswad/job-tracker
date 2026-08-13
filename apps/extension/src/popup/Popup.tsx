// Off-platform search, status, and note client. The extension origin can call the
// configured API directly.

import { useCallback, useEffect, useRef, useState } from "react";
import { localDay } from "@job-tracker/shared/time";
import { BASE_URL, logSearch, noteTitles, searchJobs } from "./api.js";
import {
  DIAGNOSTICS_DEFAULT,
  DIAGNOSTICS_KEY,
  type DiagnosticsSettings,
  diagnosticsBody,
  loadDiagnostics,
  sanitizeDiagnostics,
} from "../engine/diagnostics.js";
import { chooseTs, todayDay } from "./eventDate.js";
import { seedFromTab } from "./seed.js";
import { cycleTheme } from "./theme.js";
import { useFeedback } from "./feedback";
import { ICON } from "../icons.js";
import { Settings } from "./Settings";
import { Results } from "./Results";
import { Detail, type DetailHandle } from "./Detail";
import { AddForm, type AddFormHandle } from "./AddForm";
import type { PopupJob } from "./types";
import { FOCUS } from "./ui";

type Mode = "list" | "detail" | "add" | "settings";

export function Popup() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PopupJob[]>([]);
  const [selIndex, setSelIndex] = useState(-1);
  const [mode, setMode] = useState<Mode>("list");
  const [current, setCurrent] = useState<PopupJob | null>(null);
  const [msg, setMsg] = useState<{ text: string; error: boolean }>({ text: "", error: false });
  const [titles, setTitles] = useState<string[]>([]);
  // Whether the background can reach the server. Seeded from a reachability query on
  // open and kept live by the background's `reachabilityChanged` push, so the notice
  // shows before and independently of any write the user attempts.
  const [offline, setOffline] = useState(false);

  // Event date. Over a Gmail message the content script hands back that email's
  // received date, so a status recorded here is dated when the mail arrived.
  // `suggestedTs` is the full ISO, keeping the email's clock time; `eventDate` is the
  // YYYY-MM-DD the picker shows, never blank — today by default, upgraded to the
  // email's day once the content script answers. `dateTouched` gates that upgrade, so
  // a day the user picked themselves is left alone.
  const [eventDate, setEventDate] = useState(todayDay());
  const [suggestedTs, setSuggestedTs] = useState<string | null>(null);
  const dateTouched = useRef(false);

  // Detail's date setter. Any manual change marks the field touched, and the "" a
  // native date input emits on clear coerces back to today.
  const changeEventDate = useCallback((v: string) => {
    dateTouched.current = true;
    setEventDate(v || todayDay());
  }, []);

  const { ok, toast, showOk, showError } = useFeedback();

  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const detailRef = useRef<DetailHandle>(null);
  const addRef = useRef<AddFormHandle>(null);

  // The `ts` for a hand-recorded event, from the picker (eventDate.ts): today →
  // undefined so the server stamps now, the suggested email day → that exact ISO, any
  // other day → noon-local on it.
  const chosenTs = useCallback(
    (): string | undefined => chooseTs(eventDate, suggestedTs),
    [eventDate, suggestedTs],
  );

  // ── Search diagnostics ───────────────────────────────────────────────────────
  // Opt-in and off by default (engine/diagnostics.ts). A live snapshot of the stored
  // settings lets the pagehide flush — which fires during teardown, too late to read
  // storage — decide synchronously what to send. Seeded to the disabled default, so a
  // flush before the async load resolves sends nothing.
  const diag = useRef<DiagnosticsSettings>(DIAGNOSTICS_DEFAULT);
  useEffect(() => {
    loadDiagnostics((s) => (diag.current = s));
    // Keep the snapshot fresh if the user flips the setting in this same session.
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === "local" && changes[DIAGNOSTICS_KEY]) {
        diag.current = sanitizeDiagnostics(changes[DIAGNOSTICS_KEY].newValue);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  // One row per popup session keeps both sides of a correction: the original seed,
  // rule, and result count, plus the final query and result count after any
  // replacement. Flushed once on a result click or popup close, and only while the
  // selected diagnostic scope is active.
  const session = useRef({
    host: "",
    seed: "",
    seedRule: "none" as string,
    seedResults: null as number | null,
    query: "",
    results: null as number | null,
    jobId: null as string | null,
    attempted: false, // a search actually ran — nothing to log otherwise
    logged: false,
  });

  const flushSession = useCallback((keepalive = false) => {
    const s = session.current;
    if (s.logged || !s.attempted) return;
    s.logged = true;
    const body = diagnosticsBody(diag.current, {
      host: s.host || null,
      seed_rule: s.seed ? s.seedRule : null,
      seed: s.seed || null,
      seed_results: s.seedResults,
      query: s.query || null,
      results: s.results,
      job_id: s.jobId,
    });
    if (body) logSearch(body, keepalive);
  }, []);

  const renderResults = useCallback((jobs: PopupJob[]) => {
    setResults(jobs);
    setSelIndex(-1);
    setMode("list");
    setMsg({ text: jobs.length ? "" : "No matches.", error: false });
  }, []);

  const runSearch = useCallback(
    async (q: string) => {
      const s = session.current;
      s.attempted = true;
      s.query = q;
      s.results = null;
      setResults([]);
      setMsg({ text: "Searching…", error: false });
      try {
        const jobs = (await searchJobs(q)) as PopupJob[];
        if (s.seed && q === s.seed) s.seedResults = jobs.length;
        // A replacement may be issued before the seed request returns. Keep that
        // seed's result count, but never let its late response overwrite the
        // replacement on screen or its final diagnostic result count.
        if (s.query !== q) return;
        s.results = jobs.length;
        renderResults(jobs);
      } catch {
        if (s.query !== q) return;
        setMsg({ text: `Can't reach the tracker at ${BASE_URL}.`, error: true });
      }
    },
    [renderResults],
  );

  // ── Search box ─────────────────────────────────────────────────────────────────
  const onSearchChange = (raw: string) => {
    setQuery(raw);
    clearTimeout(searchTimer.current);
    // Typing a query leaves the add / settings panels — you're back to searching.
    if (mode === "add" || mode === "settings") setMode("list");
    const q = raw.trim();
    if (!q) {
      setResults([]);
      setMode("list");
      setMsg({ text: "", error: false });
      return;
    }
    searchTimer.current = setTimeout(() => void runSearch(q), 200);
  };

  // A click on a result is the success signal — flush before anything else.
  const onPick = useCallback(
    (job: PopupJob) => {
      session.current.jobId = job.id;
      flushSession();
      setCurrent(job);
      setMode("detail");
      setMsg({ text: "", error: false });
    },
    [flushSession],
  );

  // Keep the results row's subtitle in step with a status change made in its detail
  // view, so returning to the list never shows a stale status.
  const onStatusChange = useCallback((updated: PopupJob) => {
    setCurrent(updated);
    setResults((rs) => rs.map((r) => (r.id === updated.id ? { ...r, status: updated.status } : r)));
  }, []);

  const closeAdd = useCallback(() => {
    setMode("list");
    // The form's focused input is about to unmount; hand focus to the (always-
    // mounted) search box so the user can keep typing.
    searchRef.current?.focus();
  }, []);
  const toggleAdd = useCallback(() => {
    setMode((m) => (m === "add" ? "list" : "add"));
    setMsg({ text: "", error: false });
  }, []);
  const toggleSettings = useCallback(() => {
    setMode((m) => (m === "settings" ? "list" : "settings"));
    setMsg({ text: "", error: false });
  }, []);

  const onCreated = useCallback((job: PopupJob) => {
    setCurrent(job);
    setMode("detail");
    setMsg({ text: "", error: false });
  }, []);

  // ── Keyboard ─────────────────────────────────────────────────────────────────
  // The document listener is attached once while this ref-backed handler sees current
  // state. Chrome owns Escape; Backspace outside fields navigates within the popup.
  const goBack = () => {
    if (mode === "add") return closeAdd();
    if (mode === "settings") {
      setMode("list");
      searchRef.current?.focus();
      return;
    }
    if (mode === "detail") {
      setMode("list");
      setCurrent(null);
      // The search row is hidden in detail, so the box is unmounted right now —
      // refocus it only after the list re-renders and remounts it (rAF), not now.
      requestAnimationFrame(() => searchRef.current?.focus());
      return;
    }
    if (query) {
      setQuery("");
      setResults([]);
      setMsg({ text: "", error: false });
      searchRef.current?.focus();
      return;
    }
    window.close();
  };

  const handleKey = (e: KeyboardEvent) => {
    const el = document.activeElement as HTMLElement | null;
    const isTyping =
      !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");

    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (mode === "add") addRef.current?.submit();
      else if (mode === "detail") detailRef.current?.submitOpenForm();
      return;
    }

    // Result navigation — live whenever a result list is showing, even while the
    // search box holds focus (a single-line input ignores ↑/↓ anyway).
    if (mode === "list" && results.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        return selectResult(selIndex + 1);
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        return selectResult(selIndex - 1);
      }
      if (e.key === "Enter") {
        e.preventDefault();
        return onPick(results[selIndex < 0 ? 0 : selIndex]);
      }
    }

    if (isTyping) return; // below here: keys that act on the shown job

    // Backspace is the staged back key — only outside a field, so it never competes
    // with deleting text. (Esc is Chrome's close-the-popup accelerator; see goBack.)
    if (e.key === "Backspace") {
      e.preventDefault();
      return goBack();
    }
    // Detail keys come first so `n` means "note" while a job is open; everywhere
    // else `n` starts a new job below.
    if (mode === "detail" && current) {
      if (e.key === "s") {
        e.preventDefault();
        return detailRef.current?.openStatus();
      }
      if (e.key === "c") {
        e.preventDefault();
        return detailRef.current?.toggleComment();
      }
      if (e.key === "n") {
        e.preventDefault();
        return detailRef.current?.toggleNote();
      }
    }
    if (e.key === "n") {
      e.preventDefault();
      return toggleAdd();
    }
    if (e.key === "?") {
      e.preventDefault();
      return toggleSettings();
    }
    if (e.key === "t") {
      e.preventDefault();
      return cycleTheme();
    }
  };

  // Move the ↑/↓ highlight. The search box keeps focus (so typing keeps refining the
  // query); we just paint a selection ring and scroll it into view.
  function selectResult(i: number) {
    if (!results.length) return;
    const n = (i + results.length) % results.length; // wrap both ends
    setSelIndex(n);
    const rows = document.querySelectorAll<HTMLElement>("#results .result");
    rows[n]?.scrollIntoView({ block: "nearest" });
  }

  const keyHandlerRef = useRef(handleKey);
  keyHandlerRef.current = handleKey;
  // Capture phase so the shortcuts reach us before an open native widget (the
  // status <select>, the date picker) or a focused field can swallow them.
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyHandlerRef.current(e);
    document.addEventListener("keydown", listener, { capture: true });
    return () => document.removeEventListener("keydown", listener, { capture: true });
  }, []);

  // The popup closing is the "abandoned" signal — send what we have, surviving
  // teardown via fetch keepalive. A prior click already flushed, so this no-ops then.
  useEffect(() => {
    const onHide = () => flushSession(true);
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [flushSession]);

  // ── Reachability ─────────────────────────────────────────────────────────────
  // Ask the background whether the server is reachable (a cached flag, no fetch),
  // then listen for flips while the popup stays open. The standing #offline-note is
  // orthogonal to the per-search failure message below: this catches "already down
  // at open time", that catches the race where the background still thinks it's up.
  useEffect(() => {
    chrome.runtime.sendMessage({ type: "reachability" }, (resp) => {
      if (chrome.runtime.lastError || !resp?.ok) return;
      setOffline(!resp.result.reachable);
    });
    const onMessage = (m: { type?: string; reachable?: boolean }) => {
      if (m?.type === "reachabilityChanged") setOffline(!m.reachable);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  // ── Init: note-title suggestions + seed from the active tab ─────────────────────
  useEffect(() => {
    void noteTitles().then((t) => setTitles(t as string[]));

    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      try {
        session.current.host = tab?.url ? new URL(tab.url).hostname : "";
      } catch {
        session.current.host = "";
      }
      // Over an open Gmail message, ask the content script for that email's received
      // date so a status recorded here defaults to when the mail arrived, not now.
      // Best-effort: no content script / no email open / not Gmail → silently skip.
      if (tab?.id && session.current.host === "mail.google.com") {
        chrome.tabs.sendMessage(tab.id, { type: "getEventDate" }, (resp) => {
          if (chrome.runtime.lastError || !resp?.ts) return;
          setSuggestedTs(resp.ts);
          if (!dateTouched.current) setEventDate(localDay(resp.ts));
        });
      }
      const seed = seedFromTab(tab);
      session.current.seed = seed.value;
      session.current.seedRule = seed.rule;
      if (seed.value) {
        setQuery(seed.value);
        void runSearch(seed.value);
        // Select the seeded text after React flushes the controlled value, so a
        // wrong guess costs one keystroke, not a clear-and-retype.
        requestAnimationFrame(() => {
          searchRef.current?.focus();
          searchRef.current?.select();
        });
      } else {
        searchRef.current?.focus();
      }
    });
    // Run once on mount — the seed/host read is a one-shot at open time.
  }, [runSearch]);

  return (
    <>
      {/* Fixed-position feedback — must stay ahead of the .section block: the
          divider-removal rule keys off `.section:last-of-type`. */}
      <div
        id="toast"
        className={
          toast
            ? "pointer-events-none fixed right-3 bottom-3 left-3 z-10 translate-y-0 rounded-md bg-popup-danger px-3 py-2 text-center text-xs leading-snug text-white opacity-100 shadow-[0_4px_14px_var(--shadow-strong)] transition-[opacity,transform] duration-200"
            : "pointer-events-none fixed right-3 bottom-3 left-3 z-10 translate-y-1.5 rounded-md bg-popup-danger px-3 py-2 text-center text-xs leading-snug text-white opacity-0 shadow-[0_4px_14px_var(--shadow-strong)] transition-[opacity,transform] duration-200"
        }
      >
        {toast}
      </div>
      <div
        id="ok"
        aria-hidden="true"
        className={
          ok
            ? "pointer-events-none fixed right-3 bottom-3 z-10 flex size-[22px] scale-100 items-center justify-center rounded-full bg-popup-success text-[13px] leading-none text-white opacity-100 shadow-[0_2px_8px_var(--shadow-strong)] transition-[opacity,transform]"
            : "pointer-events-none fixed right-3 bottom-3 z-10 flex size-[22px] scale-50 items-center justify-center rounded-full bg-popup-success text-[13px] leading-none text-white opacity-0 shadow-[0_2px_8px_var(--shadow-strong)] transition-[opacity,transform]"
        }
      >
        ✓
      </div>

      <div className="p-3.5">
        {/* The search row (box + settings toggles) is the list/add surface; it's
            dropped entirely while a job detail is open, where none of it applies —
            the detail's own "← Back" is the way out. Keeping it mounted only in
            those modes also means returning refocuses a freshly-mounted box. */}
        {mode !== "detail" && (
          <div className="flex items-center gap-1.5">
            <input
              ref={searchRef}
              id="search"
              className="min-w-0 flex-1 rounded-md border border-popup-border bg-popup-surface px-2.5 py-[7px] text-[13px] text-popup-fg outline-none focus:border-popup-border-strong focus-visible:outline-2 focus-visible:outline-popup-focus focus-visible:outline-offset-1"
              type="search"
              placeholder="Search jobs…"
              autoComplete="off"
              value={query}
              onChange={(e) => onSearchChange(e.target.value)}
            />
            <button
              className={
                mode === "settings"
                  ? "flex size-8 shrink-0 items-center justify-center rounded-md border border-popup-primary bg-popup-primary text-white " +
                    FOCUS +
                    " [&_svg]:size-4"
                  : "flex size-8 shrink-0 items-center justify-center rounded-md border border-popup-border bg-popup-surface text-popup-button transition-colors hover:bg-popup-hover " +
                    FOCUS +
                    " [&_svg]:size-4"
              }
              title="Settings — Easy Apply, theme, and display"
              aria-label="Settings"
              onClick={toggleSettings}
              dangerouslySetInnerHTML={{ __html: ICON.settings }}
            />
            <button
              id="add-toggle"
              className={
                mode === "add"
                  ? "flex size-8 shrink-0 items-center justify-center rounded-md border border-popup-primary bg-popup-primary p-0 text-lg leading-none text-white " +
                    FOCUS
                  : "flex size-8 shrink-0 items-center justify-center rounded-md border border-popup-border bg-popup-surface p-0 text-lg leading-none text-popup-button transition-colors hover:bg-popup-hover " +
                    FOCUS
              }
              title="Add a job the extension didn't capture"
              onClick={toggleAdd}
            >
              ＋
            </button>
          </div>
        )}

        {offline && (
          <div
            id="offline-note"
            className="mt-2 rounded-md border border-popup-danger-border bg-popup-danger-bg px-2.5 py-2 text-xs leading-snug text-popup-danger"
          >
            Can't reach the tracker at {BASE_URL} — changes aren't being saved.
          </div>
        )}

        {/* The offline note already states the reachability failure; when it's up,
            don't also echo the per-search "Can't reach the tracker" error here. */}
        <div
          id="msg"
          className={
            msg.error && !offline
              ? "mt-2 empty:hidden text-xs leading-snug text-popup-danger"
              : "mt-2 empty:hidden text-xs leading-snug text-popup-faint"
          }
        >
          {offline && msg.error ? "" : msg.text}
        </div>

        {mode === "list" && <Results jobs={results} selIndex={selIndex} onPick={onPick} />}
        {mode === "settings" && <Settings />}
        {mode === "detail" && current && (
          <Detail
            ref={detailRef}
            job={current}
            eventDate={eventDate}
            setEventDate={changeEventDate}
            suggestedTs={suggestedTs}
            chosenTs={chosenTs}
            onBack={goBack}
            onStatusChange={onStatusChange}
            showOk={showOk}
            showError={showError}
          />
        )}
        {mode === "add" && (
          <AddForm
            ref={addRef}
            onCreated={onCreated}
            onCancel={closeAdd}
            showOk={showOk}
            showError={showError}
          />
        )}
      </div>

      <datalist id="note-titles">
        {titles.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </>
  );
}
