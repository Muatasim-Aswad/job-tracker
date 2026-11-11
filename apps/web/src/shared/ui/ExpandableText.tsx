import { copy } from "./copy";
import { useCallback, useEffect, useRef, useState } from "react";
import { Linkify } from "./Linkify";

// Shared expandable prose. Measure rendered overflow because character counts do
// not account for line breaks or container width.
// Tailwind requires complete class names at build time.
const CLAMP = { 2: "line-clamp-2", 3: "line-clamp-3", 6: "line-clamp-6" } as const;

export function ExpandableText({
  text,
  previewText,
  className = "",
  lines = 3,
}: {
  text: string;
  // Optional compact preview; expansion always reveals the original text.
  previewText?: string;
  className?: string;
  lines?: keyof typeof CLAMP;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef<HTMLParagraphElement | null>(null);

  const measure = useCallback(() => {
    const el = ref.current;
    // Expanded content no longer has a meaningful overflow measurement.
    if (!el || expanded) return;
    setOverflowing(el.scrollHeight > el.clientHeight + 1);
  }, [expanded]);

  useEffect(() => {
    measure();
    const el = ref.current;
    // Environments without ResizeObserver retain the initial measurement.
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, text, previewText, lines]);

  // A substituted preview must always provide access to the original text.
  const substituted = previewText !== undefined && previewText !== text;

  return (
    <div>
      <p ref={ref} className={`whitespace-pre-line ${className} ${expanded ? "" : CLAMP[lines]}`}>
        <Linkify text={expanded || previewText === undefined ? text : previewText} />
      </p>
      {(overflowing || expanded || substituted) && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-micro text-violet-600 hover:underline dark:text-violet-400"
        >
          {expanded ? copy.expandableTextMessages.showLess : copy.expandableTextMessages.showMore}
        </button>
      )}
    </div>
  );
}
