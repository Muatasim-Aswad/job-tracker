import type { ReactNode, Ref } from "react";

interface Props {
  before: string;
  after: string;
  behavior: string;
  affected: string[];
  children?: ReactNode;
  ref?: Ref<HTMLElement>;
}

export function ChangeReview({ before, after, behavior, affected, children, ref }: Props) {
  return (
    <section
      ref={ref}
      aria-label="What will change"
      className="space-y-4 rounded-lg border border-accent/40 bg-surface p-4"
    >
      <h3 className="font-semibold text-ink">What will change</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-sm text-ink-muted">Before</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-ink">{before}</p>
        </div>
        <div className="border-l-2 border-accent pl-3">
          <p className="text-sm text-ink-muted">After saving</p>
          <p className="mt-1 whitespace-pre-wrap break-words font-medium text-ink">{after}</p>
        </div>
      </div>
      <p className="text-sm text-ink">{behavior}</p>
      <details>
        <summary className="cursor-pointer text-sm font-medium text-ink">
          {affected.length} {affected.length === 1 ? "question affected" : "questions affected"}
        </summary>
        <ul className="mt-2 space-y-1 text-sm text-ink-muted">
          {affected.map((question, index) => (
            <li key={index}>{question}</li>
          ))}
        </ul>
      </details>
      {children}
    </section>
  );
}
