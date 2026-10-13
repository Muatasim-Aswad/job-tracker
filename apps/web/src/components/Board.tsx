import { useCallback, useRef } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import type { EventItem, JobSummary } from "@job-tracker/shared/api";
import {
  ACTIVE_STATUSES,
  STATUS_ACCENT,
  STATUS_LABEL,
  isBackwardMove,
  isDroppable,
  isTerminal,
  type FunnelEvent,
  type Status,
} from "@job-tracker/shared/funnel";
import { useCorrectStatus } from "../hooks";
import { usePersistentStringSet } from "../lib/persist";
import { Column } from "./Column";
import type { NavDir } from "./JobCard";

interface Props {
  jobs: JobSummary[];
  onOpen: (jobId: string) => void;
  onEvent: (jobId: string, events: EventItem[]) => void;
}

// The combined terminal column needs a stable preference key independent of status.
const CLOSED_OUT = "closed_out";

export function Board({ jobs, onOpen, onEvent }: Props) {
  // The threshold preserves clicks. Keyboard moves use guarded drawer actions;
  // dnd-kit keyboard coordinates follow DOM order rather than this spatial grid.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const correctStatus = useCorrectStatus();

  const [collapsed, toggleCollapsed] = usePersistentStringSet("jt.collapsedColumns");

  const byStatus = (s: Status) => jobs.filter((j) => j.status === s);
  const terminalJobs = jobs.filter((j) => isTerminal(j.status));

  // Keep navigation stable for memoized cards; refs supply current jobs and columns.
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  // The board owns column geometry; clamp row positions in shorter adjacent columns.
  const navigate = useCallback((fromId: string, dir: NavDir) => {
    const jobs = jobsRef.current;
    const collapsed = collapsedRef.current;
    const cols = [
      ...ACTIVE_STATUSES.map((s) => ({
        jobs: jobs.filter((j) => j.status === s),
        collapsed: collapsed.has(s),
      })),
      { jobs: jobs.filter((j) => isTerminal(j.status)), collapsed: collapsed.has(CLOSED_OUT) },
    ];
    let c = -1;
    let r = -1;
    for (let i = 0; i < cols.length; i++) {
      const idx = cols[i].jobs.findIndex((j) => j.id === fromId);
      if (idx !== -1) {
        c = i;
        r = idx;
        break;
      }
    }
    if (c === -1) return;

    let targetId: string | undefined;
    if (dir === "up") targetId = cols[c].jobs[r - 1]?.id;
    else if (dir === "down") targetId = cols[c].jobs[r + 1]?.id;
    else {
      const step = dir === "left" ? -1 : 1;
      for (let i = c + step; i >= 0 && i < cols.length; i += step) {
        const col = cols[i];
        if (col.collapsed || col.jobs.length === 0) continue;
        targetId = col.jobs[Math.min(r, col.jobs.length - 1)].id;
        break;
      }
    }
    if (targetId) {
      document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(targetId)}"]`)?.focus();
    }
  }, []);

  function onDragEnd(e: DragEndEvent) {
    const jobId = String(e.active.id);
    const target = e.over?.id;
    if (target == null) return;
    const targetStatus = String(target);
    if (!isDroppable(targetStatus)) return;
    const job = jobs.find((j) => j.id === jobId);
    if (!job || job.status === targetStatus) return;
    // Earlier-column and terminal-exit drags require correction rather than a forward event.
    if (isBackwardMove(job.status, targetStatus)) {
      correctStatus.mutate({ jobId, status: targetStatus as Status });
      return;
    }
    onEvent(jobId, [{ event: targetStatus as FunnelEvent }]);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex h-full gap-3 overflow-x-auto p-4">
        {ACTIVE_STATUSES.map((s) => (
          <Column
            key={s}
            // No event enters new, so it cannot be a drop target.
            droppableId={isDroppable(s) ? s : undefined}
            label={STATUS_LABEL[s]}
            accentDot={STATUS_ACCENT[s].dot}
            accentText={STATUS_ACCENT[s].text}
            jobs={byStatus(s)}
            collapsed={collapsed.has(s)}
            onToggleCollapse={() => toggleCollapsed(s)}
            onOpen={onOpen}
            onEvent={onEvent}
            onNavigate={navigate}
          />
        ))}
        <Column
          label="Closed out"
          accentDot={STATUS_ACCENT.closed.dot}
          accentText={STATUS_ACCENT.closed.text}
          jobs={terminalJobs}
          collapsed={collapsed.has(CLOSED_OUT)}
          onToggleCollapse={() => toggleCollapsed(CLOSED_OUT)}
          onOpen={onOpen}
          onEvent={onEvent}
          onNavigate={navigate}
        />
      </div>
    </DndContext>
  );
}
