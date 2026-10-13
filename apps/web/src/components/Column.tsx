import { useDroppable } from "@dnd-kit/core";
import type { EventItem, JobSummary } from "@job-tracker/shared/api";
import { JobCard, type NavDir } from "./JobCard";

interface Props {
  // Omit the drop ID for new and combined-terminal columns, which accept no funnel event.
  droppableId?: string;
  label: string;
  accentDot: string;
  accentText: string;
  jobs: JobSummary[];
  // Collapse is a view preference and never changes job state.
  collapsed: boolean;
  onToggleCollapse: () => void;
  onOpen: (jobId: string) => void;
  onEvent: (jobId: string, events: EventItem[]) => void;
  onNavigate: (fromId: string, dir: NavDir) => void;
}

export function Column({
  droppableId,
  label,
  accentDot,
  accentText,
  jobs,
  collapsed,
  onToggleCollapse,
  onOpen,
  onEvent,
  onNavigate,
}: Props) {
  const droppable = droppableId != null;
  // Expand a collapsed column before dropping into it.
  const { setNodeRef, isOver } = useDroppable({
    id: droppableId ?? label,
    disabled: !droppable || collapsed,
  });

  if (collapsed) {
    return (
      <button
        onClick={onToggleCollapse}
        title={`Expand ${label}`}
        className="flex w-10 shrink-0 cursor-pointer flex-col items-center gap-2 rounded-lg bg-sunken py-3 text-ink-muted transition hover:bg-surface-hover"
      >
        <span className={`h-2 w-2 rounded-full ${accentDot}`} />
        <span className="text-xs font-medium tabular-nums text-ink-soft">{jobs.length}</span>
        <span className="text-xs font-semibold uppercase tracking-wide [writing-mode:vertical-rl]">
          {label}
        </span>
      </button>
    );
  }

  return (
    <div className="flex w-64 shrink-0 flex-col">
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className={`h-2 w-2 rounded-full ${accentDot}`} />
        <span className={`text-xs font-semibold uppercase tracking-wide ${accentText}`}>
          {label}
        </span>
        <span className="text-xs text-ink-muted">{jobs.length}</span>
        <button
          onClick={onToggleCollapse}
          title={`Collapse ${label}`}
          className="ml-auto rounded px-1 text-ink-muted hover:bg-surface-hover hover:text-ink-soft"
        >
          «
        </button>
      </div>
      <div
        ref={setNodeRef}
        className={`flex min-h-24 flex-1 flex-col gap-2 rounded-lg p-2 transition ${
          isOver && droppable ? "bg-surface-hover ring-1 ring-line-strong" : "bg-sunken"
        }`}
      >
        {jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            onOpen={onOpen}
            onEvent={onEvent}
            onNavigate={onNavigate}
          />
        ))}
        {jobs.length === 0 && (
          <div className="px-1 py-2 text-xs text-ink-muted">{droppable ? "Drop here" : "—"}</div>
        )}
      </div>
    </div>
  );
}
