import type { useQuestionDraft } from "./useQuestionDraft";
import type { useQuestionActions } from "./useQuestionActions";
import { copy } from "./copy";
import { formatDate, valueText, type QuestionDetail } from "./model";
import { SOURCE_LABEL } from "./copy";

type Props = Pick<ReturnType<typeof useQuestionDraft>, "captures" | "winnerId" | "setWinnerId"> &
  Pick<ReturnType<typeof useQuestionActions>, "busy" | "chooseWinner"> & {
    question: QuestionDetail;
    onOpenCapture?: (id: string) => void;
  };

export function QuestionRememberedValues({
  captures,
  winnerId,
  setWinnerId,
  busy,
  chooseWinner,
  question,
  onOpenCapture,
}: Props) {
  return (
    <section
      className={`space-y-3 ${question.capture_conflict ? "rounded-lg border border-red-400 bg-red-50 p-4 dark:bg-red-950/20" : ""}`}
      aria-label={copy.questionDrawer.rememberedValues}
    >
      <h3
        className={
          question.capture_conflict ? "font-medium text-ink" : "text-xs font-normal text-ink-muted"
        }
      >
        {question.capture_conflict
          ? copy.questionDrawerMessages.chooseWhichRememberedValueToKeep
          : copy.questionDrawerMessages.rememberedValue}
      </h3>
      {question.capture_conflict && (
        <p className="text-sm text-ink-muted">
          {copy.questionDrawer.conflictingValuesBlockFillingKeepingOneClearsTheOther}
        </p>
      )}
      {captures.some((capture) => capture.isLoading) ? (
        <p role="status">{copy.questionDrawer.loadingRememberedValues}</p>
      ) : captures.some((capture) => capture.isError) ? (
        <p role="alert">
          {copy.questionDrawer.couldntLoadEveryRememberedValue}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => {
              for (const capture of captures) void capture.refetch();
            }}
          >
            {copy.questionDrawer.retry}
          </button>
        </p>
      ) : (
        captures.map(
          (capture) =>
            capture.data && (
              <div key={capture.data.id} className="space-y-2">
                <label className="flex items-start gap-3">
                  {question.capture_conflict && (
                    <input
                      type="radio"
                      name="capture-winner"
                      checked={winnerId === capture.data.id}
                      onChange={() => setWinnerId(capture.data!.id)}
                    />
                  )}
                  <span>
                    <span className="block whitespace-pre-wrap break-words text-lg font-normal text-ink">
                      {valueText(capture.data.value, question.options)}
                    </span>
                    {question.capture_conflict && (
                      <span className="mt-1 block text-xs text-ink-muted">
                        {SOURCE_LABEL[capture.data.source]} • {formatDate(capture.data.created_at)}
                      </span>
                    )}
                  </span>
                </label>
                {!question.capture_conflict && onOpenCapture && captures.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onOpenCapture(capture.data!.id)}
                    className="rounded-md border border-accent px-3 py-2 text-sm font-medium text-accent"
                  >
                    {copy.questionDrawer.useOrDismissThisValue}
                  </button>
                )}
              </div>
            ),
        )
      )}
      {question.capture_conflict && (
        <button
          type="button"
          disabled={
            !winnerId || busy || captures.some((capture) => !capture.data || capture.isError)
          }
          onClick={() => void chooseWinner()}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white dark:text-canvas disabled:opacity-50"
        >
          {copy.questionDrawer.keepSelectedValue}
        </button>
      )}
    </section>
  );
}
