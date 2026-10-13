// Shared TypeScript funnel rules. The server remains authoritative; contract tests
// compare this mirror with a fixture generated from the server's guards.

// Sequential active stages.
export const ACTIVE_STATUSES = [
  "new",
  "seen",
  "to_apply",
  "applied",
  "in_process",
  "offered",
] as const;
// Terminal outcomes have no rank and reopen only through correction.
export const TERMINAL_STATUSES = ["skipped", "closed", "withdrawn", "rejected", "ghosted"] as const;

export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];
export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];
export type Status = ActiveStatus | TerminalStatus;

// Funnel events share the name of the status they set; flags toggle a boolean.
// `created`/`new` are not client-submittable events.
export type FunnelEvent = Exclude<Status, "new">;
export type FlagEvent = "hidden" | "unhidden" | "starred" | "unstarred";
// A manual log entry: dated activity setting no status and no flag, so it sits outside
// the funnel lifecycle and undo/correct never touch it. Editable and deletable.
export type NoteEvent = "note";
// A deliberate dashboard correction, logged under a compound value whose prefix keeps
// it a distinct namespace in the log (server enums.CORRECTION_PREFIX).
export type CorrectedEvent = `corrected:${Status}`;
export type EventName = FunnelEvent | FlagEvent | NoteEvent | CorrectedEvent;

// Every status in display order.
const EVERY_STATUS: Status[] = [...ACTIVE_STATUSES, ...TERMINAL_STATUSES];
// Rank within the active funnel (mirrors server enums._ACTIVE_ORDER). Terminals
// have no rank — they're outcomes, not stages.
const ACTIVE_RANK: Record<string, number> = Object.fromEntries(
  ACTIVE_STATUSES.map((s, i) => [s, i]),
);
const TERMINAL_SET: ReadonlySet<string> = new Set(TERMINAL_STATUSES);

export function isTerminal(status: string): boolean {
  return TERMINAL_SET.has(status);
}

// Rank of a status within the active funnel, or undefined for terminals/unknown
// (incl. the extension's "untracked" pseudo-status, treated as before `new`).
export function activeRank(status: string): number | undefined {
  return ACTIVE_RANK[status];
}

// Organic moves advance through active stages or reach a terminal outcome.
export function forwardMoves(current: string): FunnelEvent[] {
  if (isTerminal(current)) return [];
  const rank = ACTIVE_RANK[current] ?? -1;
  const deeper = ACTIVE_STATUSES.filter((s) => s !== "new" && (ACTIVE_RANK[s] ?? -1) > rank);
  const outcomes = TERMINAL_STATUSES.filter(
    (s) => s !== "ghosted" || current === "applied" || current === "in_process",
  );
  return [...deeper, ...outcomes] as FunnelEvent[];
}

export function isForwardMove(current: string, target: string): boolean {
  return (forwardMoves(current) as readonly string[]).includes(target);
}

// Backward moves and terminal revival require a correction.
export function isBackwardMove(current: string, target: string): boolean {
  if (isTerminal(current)) return true; // reviving a closed-out job is a correction
  const cur = activeRank(current);
  const tgt = activeRank(target);
  if (cur == null || tgt == null) return false;
  return tgt < cur;
}

// Dashboard drop targets. `new` has no incoming event; terminal outcomes use actions.
export const DROP_STATUSES = ["seen", "to_apply", "applied", "in_process", "offered"] as const;

export function isDroppable(status: string): status is FunnelEvent {
  return (DROP_STATUSES as readonly string[]).includes(status);
}

export const STATUS_LABEL: Record<Status, string> = {
  new: "New",
  seen: "Seen",
  to_apply: "To apply",
  applied: "Applied",
  in_process: "In process",
  offered: "Offered",
  skipped: "Skipped",
  closed: "Closed",
  withdrawn: "Withdrawn",
  rejected: "Rejected",
  ghosted: "Ghosted",
};

// Preserve unknown values such as the extension's synthetic "untracked" status.
export function labelOf(status: string): string {
  return STATUS_LABEL[status as Status] ?? status;
}

// Tailwind fragments for dots, labels, and badge backgrounds.
export const STATUS_ACCENT: Record<Status, { dot: string; text: string; bg: string }> = {
  new: { dot: "bg-slate-400", text: "text-ink-soft", bg: "bg-slate-500/15" },
  seen: { dot: "bg-sky-400", text: "text-sky-700 dark:text-sky-300", bg: "bg-sky-500/15" },
  to_apply: {
    dot: "bg-indigo-400",
    text: "text-indigo-700 dark:text-indigo-300",
    bg: "bg-indigo-500/15",
  },
  applied: {
    dot: "bg-violet-400",
    text: "text-violet-700 dark:text-violet-300",
    bg: "bg-violet-500/15",
  },
  in_process: {
    dot: "bg-amber-400",
    text: "text-amber-700 dark:text-amber-300",
    bg: "bg-amber-500/15",
  },
  offered: {
    dot: "bg-emerald-400",
    text: "text-emerald-700 dark:text-emerald-300",
    bg: "bg-emerald-500/15",
  },
  skipped: { dot: "bg-slate-500", text: "text-ink-muted", bg: "bg-slate-500/15" },
  closed: { dot: "bg-slate-500", text: "text-ink-muted", bg: "bg-slate-500/15" },
  withdrawn: { dot: "bg-rose-400", text: "text-rose-700 dark:text-rose-300", bg: "bg-rose-500/15" },
  rejected: { dot: "bg-red-500", text: "text-red-700 dark:text-red-400", bg: "bg-red-500/15" },
  // Ghosted is visually quieter than an explicit rejection.
  ghosted: { dot: "bg-zinc-400", text: "text-zinc-600 dark:text-zinc-400", bg: "bg-zinc-500/15" },
};

export function flagEvent(kind: "hidden" | "starred", currentlyOn: boolean): FlagEvent {
  if (kind === "hidden") return currentlyOn ? "unhidden" : "hidden";
  return currentlyOn ? "unstarred" : "starred";
}

// Manual-picker guidance, not an API guard. Skipping is offered only before apply.
const APPLIED_RANK = activeRank("applied") as number;
export function pickableMoves(current: string): FunnelEvent[] {
  const appliedOrBeyond = (activeRank(current) ?? -1) >= APPLIED_RANK;
  return forwardMoves(current).filter((s) => !(appliedOrBeyond && s === "skipped"));
}

// Correction targets are the complement of organic forward moves.
export function correctionMoves(current: string): Status[] {
  const forward = new Set<string>(forwardMoves(current));
  return EVERY_STATUS.filter((s) => s !== current && !forward.has(s));
}

// Post-application active stages.
export const APPLIED: ReadonlySet<string> = new Set(["applied", "in_process", "offered"]);

// Browsing surfaces can de-emphasize post-decision and terminal jobs.
export function isResolved(status: string): boolean {
  return APPLIED.has(status) || isTerminal(status);
}

// Extension dropdown vocabulary; other transitions have dedicated surfaces.
const SETTABLE: ReadonlySet<string> = new Set(["to_apply", "applied", "skipped"]);

// Keep pre-application decisions out of post-application pickers.
export function settableChoices(current: string): FunnelEvent[] {
  return forwardMoves(current).filter(
    (s) => SETTABLE.has(s) && !(s === "skipped" && APPLIED.has(current)),
  );
}

export function canSet(current: string, target: string): boolean {
  return (settableChoices(current) as readonly string[]).includes(target);
}

// Organic transitions and corrections set status; flags, notes, and creation do not.
export function isStatusSettingEvent(event: string): boolean {
  if (event.startsWith("corrected:")) return true;
  return event !== "new" && event in STATUS_LABEL;
}

// The non-status half of the event vocabulary: birth, flags, and manual notes.
// Status-setting verbs are deliberately absent, taking their label from STATUS_LABEL
// instead, so a status and the event that sets it can never read differently.
const NON_STATUS_EVENT_LABEL: Record<string, string> = {
  created: "Created",
  hidden: "Hidden",
  unhidden: "Unhidden",
  starred: "Starred",
  unstarred: "Unstarred",
  note: "Note",
};

// Human label for a timeline row. A `corrected:<status>` row reads as an explicit
// override ("Corrected → Applied") and an organic status event as the status it sets
// ("In process"), so the two are visibly the same vocabulary. Anything unknown falls
// back to its raw verb rather than being mangled.
export function eventLabel(event: string): string {
  if (event.startsWith("corrected:")) {
    const to = event.slice("corrected:".length);
    return `Corrected → ${STATUS_LABEL[to as Status] ?? to}`;
  }
  return STATUS_LABEL[event as Status] ?? NON_STATUS_EVENT_LABEL[event] ?? event;
}

// Namespace interface for extension consumers.
export const JobFunnel = {
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  isTerminal,
  activeRank,
  forwardMoves,
  isForwardMove,
  settableChoices,
  canSet,
  APPLIED,
  isResolved,
  labelOf,
};
