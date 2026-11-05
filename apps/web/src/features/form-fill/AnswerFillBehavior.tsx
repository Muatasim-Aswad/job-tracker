import { copy } from "./copy";
import type { AnswerDraft } from "./answerDraft";
import { HelpTip } from "./HelpTip";
import { fillExplanation } from "./copy";

interface Props {
  policy: AnswerDraft["fillPolicy"];
  status: AnswerDraft["status"];
  onChange: (policy: AnswerDraft["fillPolicy"]) => void;
}

export function AnswerFillBehavior({ policy, status, onChange }: Props) {
  return (
    <label className="block text-xs font-normal text-ink-muted">
      {copy.answerFillBehavior.fillBehavior}
      <HelpTip text={fillExplanation(policy, status)} className="block">
        <select
          value={policy}
          onChange={(event) => onChange(event.target.value as AnswerDraft["fillPolicy"])}
          className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2.5 text-sm font-normal text-ink focus:border-accent focus:outline-none"
        >
          <option value="auto">{copy.answerFillBehavior.automatic}</option>
          <option value="confirm_each_time">{copy.answerFillBehavior.askEveryTime}</option>
          <option value="never">{copy.answerFillBehavior.neverFill}</option>
        </select>
      </HelpTip>
    </label>
  );
}
