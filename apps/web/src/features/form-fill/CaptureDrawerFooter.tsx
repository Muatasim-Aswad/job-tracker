import type { useCaptureDraft } from "./useCaptureDraft";
import type { useCaptureActions } from "./useCaptureActions";
import { copy } from "./copy";
import { HelpTip } from "./HelpTip";

type Props = Pick<
  ReturnType<typeof useCaptureDraft>,
  "reviewed" | "actionValid" | "setReviewedContext" | "reviewContext"
> &
  Pick<ReturnType<typeof useCaptureActions>, "busy" | "apply"> & { onNext?: () => void };

export function CaptureDrawerFooter({
  reviewed,
  actionValid,
  setReviewedContext,
  reviewContext,
  busy,
  apply,
  onNext,
}: Props) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3">
        {!reviewed ? (
          <HelpTip text={copy.captureDrawer.checkTheValueAndAffectedQuestionsBeforeSaving}>
            <button
              type="button"
              disabled={!actionValid || busy}
              onClick={() => setReviewedContext(reviewContext)}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white dark:text-canvas disabled:opacity-50"
            >
              {copy.captureDrawer.reviewChanges}
            </button>
          </HelpTip>
        ) : (
          <>
            <HelpTip text={copy.captureDrawer.checkTheValueAndAffectedQuestionsBeforeSaving}>
              <button
                type="button"
                disabled={!actionValid || busy}
                onClick={() => void apply()}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white dark:text-canvas disabled:opacity-50"
              >
                {busy ? copy.captureDrawerMessages.saving : copy.captureDrawerMessages.saveChanges}
              </button>
            </HelpTip>
            {onNext && (
              <HelpTip text={copy.captureDrawer.saveTheseChangesThenOpenTheNextQuestion}>
                <button
                  type="button"
                  disabled={!actionValid || busy}
                  onClick={() => void apply(true)}
                  className="rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent disabled:opacity-50"
                >
                  {copy.captureDrawer.saveAndReviewNext}
                </button>
              </HelpTip>
            )}
          </>
        )}
      </div>
      {!actionValid && (
        <p className="text-xs text-ink-muted">
          {copy.captureDrawer.chooseAnActionAndCompleteAnyMissingChoiceMatches}
        </p>
      )}
    </div>
  );
}
