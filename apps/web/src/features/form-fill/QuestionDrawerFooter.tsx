import type { useQuestionDraft } from "./useQuestionDraft";
import type { useQuestionActions } from "./useQuestionActions";
import { copy } from "./copy";
import { HelpTip } from "./HelpTip";

type Props = Pick<
  ReturnType<typeof useQuestionDraft>,
  | "rememberedCapture"
  | "answerId"
  | "draft"
  | "baseline"
  | "reviewed"
  | "canReview"
  | "setReviewedContext"
  | "reviewContext"
  | "complete"
> &
  Pick<ReturnType<typeof useQuestionActions>, "busy" | "saveMapping"> & {
    onOpenCapture?: (id: string) => void;
    onNext?: () => void;
  };

export function QuestionDrawerFooter({
  rememberedCapture,
  answerId,
  draft,
  baseline,
  reviewed,
  canReview,
  setReviewedContext,
  reviewContext,
  complete,
  busy,
  saveMapping,
  onOpenCapture,
  onNext,
}: Props) {
  return rememberedCapture && onOpenCapture && (!answerId || draft === baseline) && !reviewed ? (
    <button
      type="button"
      disabled={busy}
      onClick={() => onOpenCapture(rememberedCapture.id)}
      className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white dark:text-canvas disabled:opacity-50"
    >
      {copy.questionDrawer.reviewRememberedValue}
    </button>
  ) : (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3">
        {!reviewed ? (
          <HelpTip text={copy.questionDrawer.checkTheAnswerValueAndFillBehaviorBeforeSaving}>
            <button
              type="button"
              disabled={!canReview || busy}
              onClick={() => setReviewedContext(reviewContext)}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white dark:text-canvas disabled:opacity-50"
            >
              {copy.questionDrawer.reviewMatch}
            </button>
          </HelpTip>
        ) : (
          <>
            <HelpTip text={copy.questionDrawer.checkTheAnswerValueAndFillBehaviorBeforeSaving}>
              <button
                type="button"
                disabled={!canReview || busy}
                onClick={() => void saveMapping()}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white dark:text-canvas disabled:opacity-50"
              >
                {busy ? copy.questionDrawerMessages.saving : copy.questionDrawerMessages.saveMatch}
              </button>
            </HelpTip>
            {onNext && (
              <HelpTip text={copy.questionDrawer.saveThisMatchThenOpenTheNextQuestion}>
                <button
                  type="button"
                  disabled={!canReview || busy}
                  onClick={() => void saveMapping(true)}
                  className="rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent disabled:opacity-50"
                >
                  {copy.questionDrawer.saveAndReviewNext}
                </button>
              </HelpTip>
            )}
          </>
        )}
      </div>
      {answerId && !complete && (
        <p className="text-xs text-ink-muted">
          {copy.questionDrawer.matchEveryFormChoiceBeforeSaving}
        </p>
      )}
    </div>
  );
}
