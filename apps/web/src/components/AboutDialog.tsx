import { useRef } from "react";
import { X } from "lucide-react";
import { runningBuild, sameBuild, type BuildInfo } from "../lib/buildInfo";
import type { BuildCheck } from "../lib/useBuildCheck";
import { useFocusTrap, useScrollLock } from "../lib/useFocusTrap";
import { IconButton } from "./IconButton";

const BUTTON =
  "rounded border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";

function BuildDetails({ info }: { info: BuildInfo }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
      <dt className="text-ink-muted">Version</dt>
      <dd>{info.version}</dd>
      <dt className="text-ink-muted">Revision</dt>
      <dd className="break-all">{info.revision}</dd>
      <dt className="text-ink-muted">Commit time</dt>
      <dd>{info.commit_time ?? "Unverified"}</dd>
      <dt className="text-ink-muted">Build time</dt>
      <dd>{info.build_time}</dd>
      <dt className="text-ink-muted">Build state</dt>
      <dd>{info.dev ? "Development (unverified source)" : "Verified source"}</dd>
    </dl>
  );
}

export function AboutDialog({
  onClose,
  result,
  onCheck,
  onReload,
}: {
  onClose: () => void;
  result: BuildCheck;
  onCheck: () => void;
  onReload: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, onClose);
  useScrollLock();
  const different = result.status === "checked" && !sameBuild(runningBuild, result.current);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-overlay" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="About Job Tracker"
        tabIndex={-1}
        className="relative z-10 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-line bg-canvas p-5 text-ink shadow-2xl outline-none"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">About Job Tracker</h2>
          <IconButton label="Close" onClick={onClose} className="text-ink-faint hover:text-ink">
            <X size={16} />
          </IconButton>
        </div>
        <p className="mb-5 text-sm text-ink-soft">
          Track job opportunities, application history, and reusable answers in one place.
        </p>
        <section aria-label="Running build">
          <h3 className="mb-3 text-xs font-semibold">Running build</h3>
          <BuildDetails info={runningBuild} />
          {runningBuild.dev && (
            <p className="mt-3 text-xs text-ink-muted">
              Development builds cannot identify source changes reliably.
            </p>
          )}
        </section>
        <section aria-label="Current build check" className="mt-5 border-t border-line pt-4">
          <div role="status" aria-live="polite" className="mb-3 text-xs text-ink-soft">
            {result.status === "checking"
              ? "Checking the server’s current build…"
              : result.status === "failed"
                ? "Couldn’t check the current build. Check your connection and try again."
                : different
                  ? "The server has a different build. Reload to load it."
                  : runningBuild.dev
                    ? "The server reports the same development identity; source changes may still differ."
                    : "You’re running the current build."}
          </div>
          {different && result.status === "checked" && (
            <section aria-label="Server build" className="mb-4">
              <h3 className="mb-3 text-xs font-semibold">Server build</h3>
              <BuildDetails info={result.current} />
            </section>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={BUTTON}
              onClick={onCheck}
              disabled={result.status === "checking"}
            >
              {result.status === "failed" ? "Retry" : "Check again"}
            </button>
            {different && (
              <button type="button" className={BUTTON} onClick={onReload}>
                Reload
              </button>
            )}
          </div>
          {different && (
            <p className="mt-3 text-xs text-ink-muted">Save unsaved changes before reloading.</p>
          )}
        </section>
      </div>
    </div>
  );
}
