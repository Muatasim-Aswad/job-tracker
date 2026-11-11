import type { useCaptureDraft } from "./useCaptureDraft";
import { copy } from "./copy";
import { answerKey, type QuestionDetail } from "./model";
import { fillExplanation, VALUE_KIND_LABEL } from "./copy";
import { valueKindForQuestion } from "./answerDraft";
import { HelpTip } from "./HelpTip";

type Props = Pick<
  ReturnType<typeof useCaptureDraft>,
  | "label"
  | "setLabel"
  | "setKey"
  | "description"
  | "setDescription"
  | "fillPolicy"
  | "setFillPolicy"
  | "setReviewedContext"
> & { question: QuestionDetail; stableKey: string };

export function CaptureNewAnswerFields({
  label,
  setLabel,
  stableKey,
  setKey,
  description,
  setDescription,
  fillPolicy,
  setFillPolicy,
  setReviewedContext,
  question,
}: Props) {
  return (
    <div className="space-y-4">
      <details className="border-t border-line pt-3 text-sm text-ink-muted">
        <summary className="cursor-pointer font-medium">{copy.captureDrawer.answerDetails}</summary>
        <div className="mt-3 space-y-3">
          <dl>
            <dt className="text-xs text-ink-muted">{copy.captureDrawer.valueType}</dt>
            <dd className="mt-1 text-sm text-ink">
              {VALUE_KIND_LABEL[valueKindForQuestion(question.control_kind)]}
            </dd>
          </dl>
          <label className="block flex-1 text-xs font-normal text-ink-muted">
            {copy.captureDrawer.fillBehavior}
            <HelpTip text={fillExplanation(fillPolicy)} className="block">
              <select
                value={fillPolicy}
                onChange={(event) => {
                  setFillPolicy(event.target.value as typeof fillPolicy);
                  setReviewedContext(null);
                }}
                className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm font-normal text-ink"
              >
                <option value="auto">{copy.captureDrawer.automatic}</option>
                <option value="confirm_each_time">{copy.captureDrawer.askEveryTime}</option>
                <option value="never">{copy.captureDrawer.neverFill}</option>
              </select>
            </HelpTip>
          </label>
          <label className="block text-xs font-normal text-ink-muted">
            {copy.captureDrawer.answerName}
            <input
              value={label}
              onChange={(event) => {
                const next = event.target.value;
                setReviewedContext(null);
                setLabel(next);
                if (!stableKey || stableKey === answerKey(label)) setKey(answerKey(next));
              }}
              className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm font-normal text-ink"
            />
          </label>

          <label className="block text-xs font-normal text-ink-muted">
            {copy.captureDrawer.stableKey}
            <HelpTip
              text={copy.captureDrawer.generatedFromTheLabelChangeItOnlyToDistinguish}
              className="block"
            >
              <input
                value={stableKey}
                onChange={(event) => {
                  setKey(answerKey(event.target.value));
                  setReviewedContext(null);
                }}
                className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-sm font-normal text-ink"
              />
            </HelpTip>
          </label>
          <label className="block text-xs font-normal text-ink-muted">
            {copy.captureDrawer.description}
            <textarea
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                setReviewedContext(null);
              }}
              rows={2}
              className="mt-1 w-full rounded border border-line bg-surface px-3 py-2 text-sm font-normal text-ink"
            />
          </label>
        </div>
      </details>
    </div>
  );
}
