import { copy } from "./copy";
import { useRef } from "react";
import { X } from "lucide-react";
import { runningBuild, sameBuild, type BuildInfo } from "./buildInfo";
import type { BuildCheck } from "./useBuildCheck";
import { useFocusTrap, useScrollLock } from "../shared/useFocusTrap";
import { IconButton } from "../shared/ui/IconButton";

const BUTTON =
  "rounded border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";

function BuildDetails({ info }: { info: BuildInfo }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
      <dt className="text-ink-muted">{copy.aboutDialog.version}</dt>
      <dd>{info.version}</dd>
      <dt className="text-ink-muted">{copy.aboutDialog.revision}</dt>
      <dd className="break-all">{info.revision}</dd>
      <dt className="text-ink-muted">{copy.aboutDialog.commitTime}</dt>
      <dd>{info.commit_time ?? copy.aboutDialogMessages.unverified}</dd>
      <dt className="text-ink-muted">{copy.aboutDialog.buildTime}</dt>
      <dd>{info.build_time}</dd>
      <dt className="text-ink-muted">{copy.aboutDialog.buildState}</dt>
      <dd>
        {info.dev
          ? copy.aboutDialogMessages.developmentUnverifiedSource
          : copy.aboutDialogMessages.verifiedSource}
      </dd>
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
        aria-label={copy.aboutDialog.aboutJobTracker}
        tabIndex={-1}
        className="relative z-10 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-line bg-canvas p-5 text-ink shadow-2xl outline-none"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{copy.aboutDialog.aboutJobTracker}</h2>
          <IconButton
            label={copy.aboutDialog.close}
            onClick={onClose}
            className="text-ink-faint hover:text-ink"
          >
            <X size={16} />
          </IconButton>
        </div>
        <p className="mb-5 text-sm text-ink-soft">
          {copy.aboutDialog.trackJobOpportunitiesApplicationHistoryAndReusableAnswersIn}
        </p>
        <section aria-label={copy.aboutDialog.runningBuild}>
          <h3 className="mb-3 text-xs font-semibold">{copy.aboutDialog.runningBuild}</h3>
          <BuildDetails info={runningBuild} />
          {runningBuild.dev && (
            <p className="mt-3 text-xs text-ink-muted">
              {copy.aboutDialog.developmentBuildsCannotIdentifySourceChangesReliably}
            </p>
          )}
        </section>
        <section
          aria-label={copy.aboutDialog.currentBuildCheck}
          className="mt-5 border-t border-line pt-4"
        >
          <div role="status" aria-live="polite" className="mb-3 text-xs text-ink-soft">
            {result.status === "checking"
              ? copy.aboutDialogMessages.checkingTheServersCurrentBuild
              : result.status === "failed"
                ? copy.aboutDialogMessages.couldntCheckTheCurrentBuildCheckYourConnectionAnd
                : different
                  ? copy.aboutDialogMessages.theServerHasADifferentBuildReloadToLoad
                  : runningBuild.dev
                    ? copy.aboutDialogMessages
                        .theServerReportsTheSameDevelopmentIdentitySourceChanges
                    : copy.aboutDialogMessages.youreRunningTheCurrentBuild}
          </div>
          {different && result.status === "checked" && (
            <section aria-label={copy.aboutDialog.serverBuild} className="mb-4">
              <h3 className="mb-3 text-xs font-semibold">{copy.aboutDialog.serverBuild}</h3>
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
              {result.status === "failed"
                ? copy.aboutDialogMessages.retry
                : copy.aboutDialogMessages.checkAgain}
            </button>
            {different && (
              <button type="button" className={BUTTON} onClick={onReload}>
                {copy.aboutDialog.reload}
              </button>
            )}
          </div>
          {different && (
            <p className="mt-3 text-xs text-ink-muted">
              {copy.aboutDialog.saveUnsavedChangesBeforeReloading}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
