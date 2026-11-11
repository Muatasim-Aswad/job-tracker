import { copy } from "./copy";
import { Pencil } from "lucide-react";
import { IconButton } from "../../shared/ui/IconButton";
import { formKeys } from "../../shared/forms";
import type { AnswerDetail, QuestionDetail } from "./model";

interface Props {
  answer: AnswerDetail | undefined;
  context: QuestionDetail | null;
  label: string;
  editingName: boolean;
  finishName: () => void;
  cancelName: () => void;
  startName: () => void;
  onLabelChange: (label: string) => void;
}

export function AnswerDrawerTitle({
  answer,
  context,
  label,
  editingName,
  finishName,
  cancelName,
  startName,
  onLabelChange,
}: Props) {
  if (!answer) {
    return context ? (
      <h2 className="text-lg font-semibold leading-7 text-ink">{context.raw_question}</h2>
    ) : null;
  }
  return editingName ? (
    <div className="space-y-2" onKeyDown={formKeys(finishName, cancelName)}>
      <input
        aria-label={copy.answerDrawer.answerName}
        autoFocus
        required
        value={label}
        onChange={(event) => onLabelChange(event.target.value)}
        className="w-full rounded border border-line bg-surface px-3 py-2 text-lg font-semibold text-ink"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!label.trim()}
          onClick={finishName}
          className="rounded bg-accent px-2 py-1 text-xs font-medium text-white dark:text-canvas disabled:opacity-50"
        >
          {copy.answerDrawer.done}
        </button>
        <button
          type="button"
          onClick={cancelName}
          className="rounded px-2 py-1 text-xs text-ink-muted hover:text-ink"
        >
          {copy.answerDrawer.cancel}
        </button>
      </div>
    </div>
  ) : (
    <div className="flex items-center gap-2">
      <h2 title={label} className="line-clamp-2 text-lg font-semibold text-ink">
        {label || answer.label}
      </h2>
      <IconButton
        label={copy.answerDrawer.editAnswerName}
        onClick={startName}
        className="shrink-0 text-ink-muted hover:text-ink"
      >
        <Pencil size={16} />
      </IconButton>
    </div>
  );
}
