import { Bell, Check, Clock3, Pencil, X } from "lucide-react";
import type { NotificationItem } from "@job-tracker/shared/api";
import { retainedDateTime } from "../../shared/format";
import { ExpandableText } from "../../shared/ui/ExpandableText";
import { IconButton } from "../../shared/ui/IconButton";
import { copy } from "./copy";

export function NotificationCard({
  item,
  busy,
  onRead,
  onEdit,
  onCancel,
  onOpenJob,
}: {
  item: NotificationItem;
  busy: boolean;
  onRead: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onOpenJob?: () => void;
}) {
  const unread = item.state === "published" && !item.read_at && !item.resolved_at;
  const editable = item.state === "scheduled" && item.kind === "manual_reminder";
  const timestamp = item.published_at ?? item.scheduled_at;
  return (
    <li
      className={`group relative isolate flex flex-col gap-2 rounded border border-line bg-surface p-3 ${item.resolved_at ? "opacity-60" : ""} ${onOpenJob && item.job_id ? "transition-colors hover:border-line-strong" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-1.5">
          <Bell size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-muted" />
          <h4 className="min-w-0 break-words text-xs font-medium text-ink">
            {onOpenJob && item.job_id ? (
              <a
                href={`/?view=jobs&job=${encodeURIComponent(item.job_id)}`}
                title={copy.openJob}
                className="after:absolute after:inset-0 after:rounded hover:text-accent focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-violet-500"
                onClick={(event) => {
                  if (
                    event.button !== 0 ||
                    event.metaKey ||
                    event.ctrlKey ||
                    event.altKey ||
                    event.shiftKey
                  )
                    return;
                  event.preventDefault();
                  onOpenJob();
                }}
              >
                {item.title}
              </a>
            ) : (
              item.title
            )}
          </h4>
          {unread && (
            <span
              className="mt-1 size-1.5 shrink-0 rounded-full bg-accent"
              aria-label={copy.unread(1)}
            />
          )}
        </div>
        <div className="relative z-10 flex shrink-0 items-center gap-1 text-ink-faint opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
          {item.state === "published" && !item.read_at && (
            <IconButton size="sm" label={copy.read} disabled={busy} onClick={onRead}>
              <Check size={13} />
            </IconButton>
          )}
          {editable && (
            <>
              <IconButton size="sm" label={copy.edit} onClick={onEdit}>
                <Pencil size={13} />
              </IconButton>
              <IconButton size="sm" label={copy.cancel} disabled={busy} onClick={onCancel}>
                <X size={13} />
              </IconButton>
            </>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-micro text-ink-muted">
        <Clock3 size={11} aria-hidden="true" />
        <time dateTime={timestamp}>{retainedDateTime(timestamp)}</time>
        {item.resolved_at && (
          <span className="rounded bg-surface-hover px-1.5 py-0.5">{copy.resolved}</span>
        )}
      </div>
      {item.body && (
        <div className="[&_a]:relative [&_a]:z-10 [&_button]:relative [&_button]:z-10">
          <ExpandableText
            text={item.body}
            lines={2}
            className="break-words text-prose leading-relaxed text-ink-soft"
          />
        </div>
      )}
    </li>
  );
}
