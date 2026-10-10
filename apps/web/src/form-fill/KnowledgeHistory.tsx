import { formatDate } from "./model";

interface Props {
  events: { id: string; event: string; created_at: string; reason?: string | null }[];
}

export function KnowledgeHistory({ events }: Props) {
  return (
    <details className="border-t border-line pt-4 text-sm text-ink-muted">
      <summary className="cursor-pointer font-medium text-ink">Activity history</summary>
      <p className="mt-2">Previous answer values are not retained.</p>
      <ul className="mt-3 space-y-2">
        {events.map((event) => (
          <li key={event.id}>
            <span className="capitalize">{event.event.replaceAll("_", " ")}</span>
            <span className="block text-xs">{formatDate(event.created_at)}</span>
            {event.reason && <p>{event.reason}</p>}
          </li>
        ))}
      </ul>
      {!events.length && <p className="mt-2">No activity yet.</p>}
    </details>
  );
}
