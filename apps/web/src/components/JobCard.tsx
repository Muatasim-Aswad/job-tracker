import { memo, useEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { EventItem, JobSummary } from "@job-tracker/shared/api";
import { useCorrectStatus } from "../hooks";
import { STATUS_LABEL, flagEvent, isTerminal, pickableMoves } from "@job-tracker/shared/funnel";
import { postingUrl } from "@job-tracker/shared/links";
import { fmtDate } from "@job-tracker/shared/time";
import { StatusBadge } from "./StatusBadge";
import { JobListingAvailability } from "./ListingAvailability";

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

  // Outside click closes the menu; Escape also restores trigger focus.
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

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [menuOpen]);

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
  // To apply links directly to an external application when available.
  const applyUrl =
    job.status === "to_apply" && primary?.apply_url && primary.apply_url !== openUrl
      ? primary.apply_url
      : null;

  // External and unknown are uninformative defaults; badge only specific apply methods.
  const applyBadges = job.apply_types.filter((a) => a !== "external" && a !== "unknown");

  // Card actions preserve forward guards; backward/revival moves require correction.
  const moves = pickableMoves(job.status);
  const advanceMoves = moves.filter((s) => !isTerminal(s));
  const outcomeMoves = moves.filter((s) => isTerminal(s));

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  // Distinguish hidden and titleless jobs revealed by view preferences.
  const borderStyle = job.hidden
    ? "border-dashed border-line-strong"
    : untitled
      ? "border-line border-l-2 border-l-amber-500/70"
      : "border-line hover:border-line-strong";

  // Opacity traps menu stacking; lift the open card and remove its dim, except while dragging.
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
        // Card shortcuts require card focus; child controls retain their own keys.
        if (e.target !== e.currentTarget) {
          // Escape from a child returns focus to the card; open menus own Escape.
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

      {job.platforms.length > 0 ||
      applyBadges.length > 0 ||
      isTerminal(job.status) ||
      job.listing_availability?.closed_count ||
      job.listing_availability?.unavailable_count ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-micro">
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
          <JobListingAvailability job={job} />
        </div>
      ) : null}

      {job.attention && (
        <div
          title={`No recorded activity since ${fmtDate(job.attention.since)} — open to review`}
          className="mt-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-micro font-medium text-amber-700 dark:text-amber-300"
        >
          {/* Separate noun-phrase stage labels to avoid "in In process". */}
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
                  // Reopening requires correction to To apply; other targets stay in the drawer.
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

// Memoized cards require stable App and Board callbacks to isolate mutation rerenders.
export const JobCard = memo(JobCardImpl);
