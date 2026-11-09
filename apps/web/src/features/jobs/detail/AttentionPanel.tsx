import { copy } from "../copy";
import type { Attention } from "@job-tracker/shared/api";
import { fmtDate } from "@job-tracker/shared/time";
import { InlineConfirm } from "../../../shared/ui/InlineConfirm";

interface Props {
  attention: Attention;
  onAddNote: () => void;
  onMarkGhosted: () => void;
}

export function AttentionPanel({ attention, onAddNote, onMarkGhosted }: Props) {
  return (
    <div className="flex flex-col gap-2 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
      <div>
        <div className="font-semibold text-amber-800 dark:text-amber-200">
          {copy.attentionPanel.needsAttention}
        </div>
        <div className="mt-0.5 text-amber-800/80 dark:text-amber-200/80">
          {copy.attentionPanel.noRecordedActivitySince}
          {fmtDate(attention.since)}.
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onAddNote}
          className="font-medium text-amber-800 hover:text-amber-950 dark:text-amber-200 dark:hover:text-white"
        >
          {copy.attentionPanel.addNote}
        </button>
        <InlineConfirm
          trigger={copy.editingHelp.markGhosted}
          confirmLabel={copy.attentionPanel.markThisJobGhosted}
          actionLabel={copy.attentionPanel.markGhosted}
          onConfirm={onMarkGhosted}
          className="text-amber-800 hover:text-red-700 dark:text-amber-200 dark:hover:text-red-300"
        />
      </div>
    </div>
  );
}
