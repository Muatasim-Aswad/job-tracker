import { useEffect, useRef, useState, type ReactNode } from "react";

export const INLINE_CHOICE_LIMIT = 10;

interface Props {
  children: ReactNode;
  count: number;
  summary: ReactNode;
  initiallyExpanded?: boolean;
}

export function ChoiceSetDisclosure({
  children,
  count,
  summary,
  initiallyExpanded = false,
}: Props) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
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
      className="text-sm text-ink-muted"
    >
      <summary className="cursor-pointer font-medium">{summary}</summary>
      {expanded && <div className="mt-3 space-y-3">{children}</div>}
    </details>
  );
}
