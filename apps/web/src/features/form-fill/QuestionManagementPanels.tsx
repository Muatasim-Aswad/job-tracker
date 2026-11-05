import type { useQuestionDraft } from "./useQuestionDraft";
import type { useQuestionActions } from "./useQuestionActions";
import { copy } from "./copy";
import { formatDate, siteLabel, type QuestionDetail } from "./model";
import { CONTROL_LABEL, SOURCE_LABEL } from "./copy";
import { HelpTip } from "./HelpTip";

type Props = Pick<ReturnType<typeof useQuestionDraft>, "captures"> &
  Pick<ReturnType<typeof useQuestionActions>, "busy" | "changeMapping" | "changeReview"> & {
    question: QuestionDetail;
  };

export function QuestionManagementPanels({
  captures,
  busy,
  changeMapping,
  changeReview,
  question,
}: Props) {
  return (
    <>
      <details className="border-t border-line pt-3 text-sm text-ink-muted">
        <summary className="cursor-pointer font-medium">
          {copy.questionDrawer.manageQuestion}
          {question.mapping?.status === "active"
            ? copy.questionDrawerMessages.matched
            : question.mapping?.status === "disabled"
              ? copy.questionDrawerMessages.fillingPaused
              : ""}
        </summary>
        <div className="mt-3 flex flex-wrap gap-3">
          {question.mapping && !question.capture_conflict && (
            <>
              <HelpTip text={copy.questionDrawer.pausingStopsFillingAndKeepsTheMatch}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void changeMapping(
                      question.mapping!.status === "active" ? "disabled" : "active",
                    )
                  }
                  className="rounded border border-line px-3 py-2"
                >
                  {question.mapping.status === "active"
                    ? copy.questionDrawerMessages.pauseFilling
                    : copy.questionDrawerMessages.resumeFilling}
                </button>
              </HelpTip>
              {question.mapping.status !== "retired" && (
                <HelpTip text={copy.questionDrawer.removeThisMatchYouCanChooseAnotherSavedAnswer}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void changeMapping("retired")}
                    className="rounded border border-line px-3 py-2"
                  >
                    {copy.questionDrawer.removeMatch}
                  </button>
                </HelpTip>
              )}
            </>
          )}
          {question.review_state === "open" && question.mapping?.status !== "active" && (
            <HelpTip
              text={copy.questionDrawer.dismissThisQuestionAndClearItsCurrentRememberedValues}
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => void changeReview("ignored")}
                className="rounded border border-line px-3 py-2"
              >
                {copy.questionDrawer.dismissQuestion}
              </button>
            </HelpTip>
          )}
        </div>
      </details>
      <details className="border-t border-line pt-3 text-sm text-ink-muted">
        <summary className="cursor-pointer font-medium">
          {copy.questionDrawer.questionDetails}
        </summary>
        {question.raw_help && (
          <p className="mt-3 max-w-prose text-xs leading-5">{question.raw_help}</p>
        )}
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs">{copy.questionDrawer.section}</dt>
            <dd className="mt-1 text-ink">{question.raw_section || "Application form"}</dd>
          </div>
          <div>
            <dt className="text-xs">{copy.questionDrawer.fieldType}</dt>
            <dd className="mt-1 text-ink">
              {CONTROL_LABEL[question.control_kind]}
              {question.option_count ? ` · ${question.option_count} choices` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-xs">{copy.questionDrawer.source}</dt>
            <dd className="mt-1 text-ink">{siteLabel(question.site_scope)}</dd>
          </div>
          <div>
            <dt className="text-xs">{copy.questionDrawer.seen}</dt>
            <dd className="mt-1 text-ink">
              {question.seen_count}{" "}
              {question.seen_count === 1
                ? copy.questionDrawerMessages.time
                : copy.questionDrawerMessages.times}
            </dd>
          </div>
        </dl>
        {captures
          .filter((capture) => capture.data)
          .map((capture) => (
            <p key={capture.data!.id} className="mt-3 text-xs">
              {SOURCE_LABEL[capture.data!.source]} · {formatDate(capture.data!.created_at)}
            </p>
          ))}
      </details>
    </>
  );
}
