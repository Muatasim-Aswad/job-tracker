import { copy } from "./copy";
import { HelpTip } from "./HelpTip";

interface Props {
  valid: boolean;
  pending: boolean;
  existing: boolean;
  hasAnswer: boolean;
  dirty: boolean;
  hasContext: boolean;
  formId: string;
  onAdvance: () => void;
}

function saveLabel(pending: boolean, existing: boolean, hasContext: boolean) {
  if (pending) return copy.answerDrawerMessages.saving;
  if (existing || !hasContext) return copy.answerDrawerMessages.saveAnswer;
  return copy.answerDrawerMessages.saveAnswerAndMatch;
}

export function AnswerDrawerFooter({
  valid,
  pending,
  existing,
  hasAnswer,
  dirty,
  hasContext,
  formId,
  onAdvance,
}: Props) {
  const help = hasContext
    ? copy.answerDrawerMessages.saveThisAnswerAndMatchItToThisQuestion
    : copy.answerDrawerMessages.saveThisAnswerAndItsFillBehavior;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <HelpTip text={!valid ? copy.answerDrawerMessages.enterAnAnswerNameAndValueToSave : help}>
        <button
          type="submit"
          form={formId}
          disabled={!valid || pending || (existing && (!hasAnswer || !dirty))}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white dark:text-canvas disabled:opacity-50"
        >
          {saveLabel(pending, existing, hasContext)}
        </button>
      </HelpTip>
      {hasContext && (
        <HelpTip text={copy.answerDrawer.saveThisAnswerAndMatchThenOpenTheNext}>
          <button
            type="button"
            disabled={!valid || pending}
            onClick={onAdvance}
            className="rounded-md border border-accent px-4 py-2 text-sm font-medium text-accent disabled:opacity-50"
          >
            {copy.answerDrawer.saveAndReviewNext}
          </button>
        </HelpTip>
      )}
      {hasAnswer && !dirty && (
        <span className="text-xs text-ink-muted">{copy.answerDrawer.noChanges}</span>
      )}
    </div>
  );
}
