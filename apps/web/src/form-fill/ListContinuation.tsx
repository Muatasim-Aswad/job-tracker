import { useEffect, useRef } from "react";

interface Props {
  hasMore: boolean;
  loading: boolean;
  failed?: boolean;
  pageKey: string;
  onLoad: () => void;
  onApproach?: () => void;
  automatic?: boolean;
  root?: HTMLElement | null;
}

export function ListContinuation({
  hasMore,
  loading,
  failed = false,
  pageKey,
  onLoad,
  onApproach,
  automatic = false,
  root = null,
}: Props) {
  const sentinel = useRef<HTMLDivElement>(null);
  const approached = useRef<string | null>(null);
  const canObserve = typeof IntersectionObserver !== "undefined";
  useEffect(() => {
    const element = sentinel.current;
    if (failed) approached.current = null;
    if (!element || !canObserve || !hasMore || loading || failed || (automatic && !root)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || approached.current === pageKey)
          return;
        approached.current = pageKey;
        if (automatic) onLoad();
        else onApproach?.();
      },
      { root, rootMargin: automatic ? "80px" : "240px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [automatic, canObserve, failed, hasMore, loading, onApproach, onLoad, pageKey, root]);

  if (!hasMore && !failed && !loading) return null;
  return (
    <div ref={sentinel} className="min-h-px text-center text-sm text-ink-muted">
      {loading ? (
        <p role="status" className="px-3 py-2">
          Loading…
        </p>
      ) : failed ? (
        <div role="alert" className="px-3 py-2">
          Couldn’t load more.{" "}
          <button
            type="button"
            onClick={onLoad}
            className="font-medium underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Retry
          </button>
        </div>
      ) : !automatic || !canObserve ? (
        <button
          type="button"
          onClick={onLoad}
          className="rounded px-3 py-2 font-medium hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        >
          Load more
        </button>
      ) : null}
    </div>
  );
}
