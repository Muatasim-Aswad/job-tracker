import type { useCaptureDraft } from "./useCaptureDraft";
import { copy } from "./copy";
import { valueText, type CaptureDetail } from "./model";

type Props = Pick<ReturnType<typeof useCaptureDraft>, "questionQuery" | "question"> & {
  capture: CaptureDetail;
  onOpenQuestion: (questionId: string) => void;
};

export function CaptureValuePanel({ questionQuery, question, capture, onOpenQuestion }: Props) {
  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => onOpenQuestion(capture.question_id)}
        className="text-sm font-medium text-accent"
      >
        {copy.captureDrawer.backToQuestion}
      </button>
      {questionQuery.isLoading ? (
        <p role="status">{copy.captureDrawer.loadingQuestionAndChoices}</p>
      ) : questionQuery.isError ? (
        <p role="alert">
          {copy.captureDrawer.couldntLoadTheFormChoices}{" "}
          <button type="button" className="underline" onClick={() => void questionQuery.refetch()}>
            {copy.captureDrawer.retry}
          </button>
        </p>
      ) : (
        <div>
          <p className="text-xs text-ink-muted">{copy.captureDrawer.rememberedValue}</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-lg font-normal text-ink">
            {valueText(capture.value, question?.options)}
          </p>
        </div>
      )}
      {capture.status !== "current" && (
        <p className="rounded border border-line bg-sunken p-3 text-sm">
          {copy.captureDrawer.thisValueHasBeenClearedOpenTheQuestionReopen}
        </p>
      )}
    </section>
  );
}
