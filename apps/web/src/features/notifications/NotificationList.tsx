import { useState } from "react";
import type { NotificationItem } from "@job-tracker/shared/api";
import { NotificationCard } from "./NotificationCard";
import { ReminderForm } from "./ReminderForm";
import { useNotificationActions, useNotifications } from "./queries";
import { copy } from "./copy";

export function NotificationList({
  state,
  jobId,
  kind,
  onOpenJob,
}: {
  state: "published" | "scheduled";
  jobId?: string;
  kind?: NotificationItem["kind"];
  onOpenJob?: (id: string) => void;
}) {
  const query = useNotifications(state, jobId, kind);
  const actions = useNotificationActions();
  const [editing, setEditing] = useState<NotificationItem | null>(null);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const busy = actions.read.isPending || actions.cancel.isPending;
  if (query.isPending)
    return (
      <p role="status" className="p-4 text-sm text-ink-muted">
        {copy.loading}
      </p>
    );
  if (query.isError)
    return (
      <div className="space-y-2 p-4 text-sm">
        <p role="alert">{copy.loadError}</p>
        <button className="text-accent" onClick={() => void query.refetch()}>
          {copy.retry}
        </button>
      </div>
    );
  return (
    <>
      {items.length === 0 && !jobId && (
        <p className="py-6 text-sm text-ink-muted">
          {state === "scheduled" ? copy.emptyScheduled : copy.emptyInbox}
        </p>
      )}
      <ul className="space-y-2">
        {items.map((item) => (
          <NotificationCard
            key={item.id}
            item={item}
            busy={busy}
            onRead={() => actions.read.mutate(item)}
            onEdit={() => setEditing(item)}
            onCancel={() => actions.cancel.mutate(item)}
            onOpenJob={item.job_id && onOpenJob ? () => onOpenJob(item.job_id!) : undefined}
          />
        ))}
      </ul>
      {query.hasNextPage && (
        <button
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
          className="my-3 rounded border border-line px-3 py-2 text-sm text-accent disabled:opacity-50"
        >
          {copy.more}
        </button>
      )}
      {editing && (
        <ReminderForm
          initial={editing}
          jobId={jobId}

          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
