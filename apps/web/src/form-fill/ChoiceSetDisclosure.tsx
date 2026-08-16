import { useEffect, useRef, useState, type ReactNode } from "react";

export const INLINE_CHOICE_LIMIT = 5;

interface Props {
  children: ReactNode;
  count: number;
  summary: ReactNode;
}

export function ChoiceSetDisclosure({ children, count, summary }: Props) {
  const [expanded, setExpanded] = useState(false);
  const previousCount = useRef(count);

  useEffect(() => {
    if (previousCount.current <= INLINE_CHOICE_LIMIT && count > INLINE_CHOICE_LIMIT) {
      setExpanded(true);
    }
    previousCount.current = count;
  }, [count]);

  if (count <= INLINE_CHOICE_LIMIT) return children;

  return (
    <details
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
      className="rounded border border-line bg-surface px-3 py-2"
    >
      <summary className="cursor-pointer text-sm font-medium text-ink">{summary}</summary>
      {expanded && <div className="mt-3 space-y-3">{children}</div>}
    </details>
  );
}
