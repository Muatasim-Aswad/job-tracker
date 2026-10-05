import { memo, useEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { EventItem, JobSummary } from "@job-tracker/shared/api";
import { useCorrectStatus } from "../hooks";
import { STATUS_LABEL, flagEvent, isTerminal, pickableMoves } from "@job-tracker/shared/funnel";
import { postingUrl } from "@job-tracker/shared/links";
import { fmtDate } from "@job-tracker/shared/time";
import { StatusBadge } from "./StatusBadge";

export type NavDir = "up" | "down" | "left" | "right";

interface Props {
  job: JobSummary;
  onOpen: (jobId: string) => void;
  onEvent: (jobId: string, events: EventItem[]) => void;
  // Move keyboard focus to an adjacent card; the board owns the grid geometry.
  onNavigate: (fromId: string, dir: NavDir) => void;
}

// Stop a pointer-down from initiating a drag when the user is clicking a control.
const noDrag = (e: React.PointerEvent) => e.stopPropagation();

const CARD_LINK =
  "rounded text-violet-600 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:text-violet-400 dark:hover:text-violet-300 hover:underline";

function JobCardImpl({ job, onOpen, onEvent, onNavigate }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const correctStatus = useCorrectStatus();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: job.id });

  // Close the ⋯ menu (restoring the card's dim/stacking) on any click outside it
  // or on Escape — the conventional dropdown behavior, and less twitchy than a
  // mouse-out that would snap shut while you're reading the options. Escape also
  // returns focus to the trigger so keyboard users aren't dropped at the top.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuTriggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // On open, move focus into the menu so it's operable from the keyboard.
  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [menuOpen]);

  // Roving arrow-key navigation between the menu's items (Home/End jump to ends).
  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  const untitled = !job.title?.trim();
  const primary = job.primary_listing;
  const openUrl = primary ? postingUrl(primary.platform, primary.platform_id, primary.url) : null;
  // Jobs waiting to be applied to link straight to an off-platform application.
  const applyUrl =
    job.status === "to_apply" && primary?.apply_url && primary.apply_url !== openUrl
      ? primary.apply_url
      : null;

  // Only surface an apply-method badge when it says something useful. `external`
  // and `unknown` are the default/uninformative cases — they'd just be noise on
  // every card, so drop them and keep the badges for signals like `easy_apply`.
  const applyBadges = job.apply_types.filter((a) => a !== "external" && a !== "unknown");

  // The same guarded forward moves the drawer offers, split into advancing the
  // active funnel vs. setting a terminal outcome. Surfacing them on the card lets
  // the funnel be driven from the keyboard without opening the drawer or dragging.
  // Backward/revival moves stay a correction (the drawer), except reopening a
  // terminal, offered below as the one correction worth reaching from the board.
  const moves = pickableMoves(job.status);
  const advanceMoves = moves.filter((s) => !isTerminal(s));
  const outcomeMoves = moves.filter((s) => isTerminal(s));

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  // Differentiate the cards that are only visible because a "show …" toggle is
  // on, so they stand out from the normal working set: hidden ones are dimmed
  // with a dashed border; untitled (stub) ones get an amber left accent.
  const borderStyle = job.hidden
    ? "border-dashed border-line-strong"
    : untitled
      ? "border-line border-l-2 border-l-amber-500/70"
      : "border-line hover:border-line-strong";

  // Opacity creates a stacking context, which would trap the ⋯ menu inside the
  // card and let sibling cards paint over it. So while the menu is open, drop the
  // dim (full opacity, clear + clickable) and lift the whole card above its
  // siblings with z-index. A dragged card keeps its drag dim.
  const dim = isDragging ? "opacity-40" : job.hidden && !menuOpen ? "opacity-60" : "";

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-card-id={job.id}
      {...listeners}
      {...attributes}
      aria-label={`${job.title ?? "Untitled"}${job.company ? `, ${job.company}` : ""}`}
      onKeyDown={(e) => {
        // Keyboard control of the focused card. Gated to the card itself — a key
        // pressed on a child control (star, hide, ⋯) does its own thing and must
        // not bubble up into these. Arrows walk the board; s/h/m are the inline
        // actions so you never have to Tab into the card's buttons.
        if (e.target !== e.currentTarget) {
          // From a control inside the card, Escape backs focus out to the card so
          // arrow navigation resumes. (An open ⋯ menu owns Escape itself.)
          if (e.key === "Escape" && !menuOpen) {
            e.stopPropagation();
            e.currentTarget.focus();
          }
          return;
        }
        switch (e.key) {
          case "Enter":
          case " ":
            e.preventDefault();
            onOpen(job.id);
            break;
          case "ArrowUp":
            e.preventDefault();
            onNavigate(job.id, "up");
            break;
          case "ArrowDown":
            e.preventDefault();
            onNavigate(job.id, "down");
            break;
          case "ArrowLeft":
            e.preventDefault();
            onNavigate(job.id, "left");
            break;
          case "ArrowRight":
            e.preventDefault();
            onNavigate(job.id, "right");
            break;
          case "s":
            e.preventDefault();
            onEvent(job.id, [{ event: flagEvent("starred", job.starred) }]);
            break;
          case "h":
            e.preventDefault();
            onEvent(job.id, [{ event: flagEvent("hidden", job.hidden) }]);
            break;
          case "m":
            e.preventDefault();
            setMenuOpen(true);
            break;
          case "o":
            if (openUrl) {
              e.preventDefault();
              window.open(openUrl, "_blank", "noopener,noreferrer");
            }
            break;
        }
      }}
      onClick={() => onOpen(job.id)}
      className={`group relative cursor-grab rounded-lg border bg-surface p-3 text-left shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${borderStyle} ${dim} ${
        menuOpen ? "z-30" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div
            className={`truncate text-sm font-medium ${
              untitled ? "text-ink-muted italic" : "text-ink"
            }`}
          >
            {untitled ? "(untitled)" : job.title}
          </div>
          <div className="truncate text-xs text-ink-muted">{job.company ?? "—"}</div>
        </div>
        <button
          onPointerDown={noDrag}
          onClick={(e) => {
            e.stopPropagation();
            onEvent(job.id, [{ event: flagEvent("starred", job.starred) }]);
          }}
          title={job.starred ? "Unstar" : "Star"}
          aria-label={job.starred ? "Unstar" : "Star"}
          aria-pressed={job.starred}
          className={`shrink-0 rounded text-base leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
            job.starred
              ? "text-amber-600 dark:text-amber-300"
              : "text-ink-muted hover:text-ink-soft"
          }`}
        >
          {job.starred ? "★" : "☆"}
        </button>
      </div>

      {(job.platforms.length > 0 || applyBadges.length > 0 || isTerminal(job.status)) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {isTerminal(job.status) && <StatusBadge status={job.status} />}
          {job.platforms.map((p) => (
            <span
              key={p}
              className="rounded bg-surface-hover px-1.5 py-0.5 text-micro text-ink-soft"
            >
              {p}
            </span>
          ))}
          {applyBadges.map((a) => (
            <span
              key={a}
              className="rounded bg-sky-500/15 px-1.5 py-0.5 text-micro text-sky-700 dark:text-sky-300"
            >
              {a}
            </span>
          ))}
        </div>
      )}

      {job.attention && (
        <div
          title={`No recorded activity since ${fmtDate(job.attention.since)} — open to review`}
          className="mt-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-micro font-medium text-amber-700 dark:text-amber-300"
        >
          {/* The stage name is a noun, so "Stalled in {stage}" read "Stalled in In
              process". Lead with the duration and name the stage after the dot. */}
          Stalled {job.attention.days} {job.attention.days === 1 ? "day" : "days"} ·{" "}
          {STATUS_LABEL[job.attention.stage]}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-micro text-ink-muted">
          <span>
            {job.listing_count} listing{job.listing_count === 1 ? "" : "s"}
          </span>
          {openUrl && (
            <a
              href={openUrl}
              target="_blank"
              rel="noreferrer"
              onPointerDown={noDrag}
              onClick={(e) => e.stopPropagation()}
              title={`Open posting (${primary?.platform})`}
              aria-label={`Open posting (${primary?.platform})`}
              className={CARD_LINK}
            >
              open ↗
            </a>
          )}
          {applyUrl && (
            <a
              href={applyUrl}
              target="_blank"
              rel="noreferrer"
              onPointerDown={noDrag}
              onClick={(e) => e.stopPropagation()}
              title={`Open application (${applyUrl})`}
              aria-label="Open application"
              className={CARD_LINK}
            >
              apply ↗
            </a>
          )}
        </div>
        <div className="flex items-center gap-2 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
          <button
            onPointerDown={noDrag}
            onClick={(e) => {
              e.stopPropagation();
              onEvent(job.id, [{ event: flagEvent("hidden", job.hidden) }]);
            }}
            title={job.hidden ? "Unhide" : "Hide"}
            aria-label={job.hidden ? "Unhide" : "Hide"}
            className="rounded text-xs text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            {job.hidden ? "unhide" : "hide"}
          </button>
          <div className="relative" ref={menuRef}>
            <button
              ref={menuTriggerRef}
              onPointerDown={noDrag}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              title="Change status"
              aria-label="Change status"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="rounded px-1 text-xs text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              ⋯
            </button>
            {menuOpen && (
              <div
                role="menu"
                aria-label="Change status"
                onPointerDown={noDrag}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={onMenuKeyDown}
                className="absolute right-0 z-10 mt-1 w-36 rounded-md border border-line bg-surface py-1 shadow-lg"
              >
                {advanceMoves.length > 0 && (
                  <>
                    <div className="px-2 py-1 text-micro uppercase tracking-wide text-ink-muted">
                      Move forward
                    </div>
                    {advanceMoves.map((s) => (
                      <button
                        key={s}
                        role="menuitem"
                        onClick={() => {
                          onEvent(job.id, [{ event: s }]);
                          setMenuOpen(false);
                        }}
                        className="block w-full px-2 py-1 text-left text-xs text-ink hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
                      >
                        {STATUS_LABEL[s]}
                      </button>
                    ))}
                  </>
                )}
                {outcomeMoves.length > 0 && (
                  <>
                    <div
                      className={`px-2 py-1 text-micro uppercase tracking-wide text-ink-muted ${
                        advanceMoves.length > 0 ? "mt-1 border-t border-line pt-1.5" : ""
                      }`}
                    >
                      Set outcome
                    </div>
                    {outcomeMoves.map((s) => (
                      <button
                        key={s}
                        role="menuitem"
                        onClick={() => {
                          onEvent(job.id, [{ event: s }]);
                          setMenuOpen(false);
                        }}
                        className="block w-full px-2 py-1 text-left text-xs text-ink hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
                      >
                        {STATUS_LABEL[s]}
                      </button>
                    ))}
                  </>
                )}
                {isTerminal(job.status) && (
                  // A terminal job has no forward moves; the only status change worth
                  // reaching from the board is reopening it — a correction (the guard
                  // refuses any organic move out of a terminal), so it routes through
                  // correct, straight to To apply: reopening means "back on, I want
                  // to apply". Landing anywhere else is the Correct panel's job.
                  <button
                    role="menuitem"
                    onClick={() => {
                      correctStatus.mutate({ jobId: job.id, status: "to_apply" });
                      setMenuOpen(false);
                    }}
                    className="block w-full px-2 py-1 text-left text-xs text-emerald-700 hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none dark:text-emerald-300"
                  >
                    Reopen (to apply)
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// A card only re-renders when its own job (or a callback) changes. The board holds
// every job and re-renders on every mutation, so without this each write would
// re-render every card; the callbacks are kept referentially stable (App's onEvent,
// Board's navigate) so this memo actually bites.
export const JobCard = memo(JobCardImpl);
