import { copy } from "./copy";
import { formatDate } from "./model";

interface Props {
  events: { id: string; event: string; created_at: string; reason?: string | null }[];
}

export function KnowledgeHistory({ events }: Props) {
  return (
    <details className="border-t border-line pt-3 text-sm text-ink-muted">
      <summary className="cursor-pointer font-medium">
        {copy.knowledgeHistory.activityHistory}
      </summary>
      <p className="mt-2">{copy.knowledgeHistory.previousAnswerValuesAreNotRetained}</p>
      <ul className="mt-3 space-y-2">
        {events.map((event) => (
          <li key={event.id}>
            <span className="capitalize">
              {event.event === "capture_ignored"
                ? copy.knowledgeHistoryMessages.rememberedValueCleared
                : event.event.replaceAll("_", " ")}
            </span>
            <span className="block text-xs">{formatDate(event.created_at)}</span>
            {event.reason && <p>{event.reason}</p>}
          </li>
        ))}
      </ul>
      {!events.length && <p className="mt-2">{copy.knowledgeHistory.noActivityYet}</p>}
    </details>
  );
}
