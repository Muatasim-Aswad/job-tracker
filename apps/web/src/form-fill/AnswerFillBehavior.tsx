import type { AnswerDraft } from "./answerDraft";
import { HelpTip } from "./HelpTip";
import { fillExplanation } from "./model";

interface Props {
  policy: AnswerDraft["fillPolicy"];
  status: AnswerDraft["status"];
  onChange: (policy: AnswerDraft["fillPolicy"]) => void;
}

export function AnswerFillBehavior({ policy, status, onChange }: Props) {
  return (
    <label className="block text-xs font-normal text-ink-muted">
      Fill behavior
      <HelpTip text={fillExplanation(policy, status)} className="block">
        <select
          value={policy}
          onChange={(event) => onChange(event.target.value as AnswerDraft["fillPolicy"])}
          className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2.5 text-sm font-normal text-ink focus:border-accent focus:outline-none"
        >
          <option value="auto">Automatic</option>
          <option value="confirm_each_time">Ask every time</option>
          <option value="never">Never fill</option>
        </select>
      </HelpTip>
    </label>
  );
}
