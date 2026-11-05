import { useState } from "react";
import type { CaptureApply } from "./client";
import type { useCaptureDraft } from "./useCaptureDraft";
import { useApplyFormFillCapture, useUpdateFormFillCapture } from "./queries";
import { captureApplyRequest } from "./captureDraft";
import { toast } from "../../shared/toast";
import { copy } from "./copy";

type Action = CaptureApply["action"];
interface Props {
  captureId: string;
  state: Pick<
    ReturnType<typeof useCaptureDraft>,
    | "capture"
    | "question"
    | "actionValid"
    | "reviewed"
    | "selectedAnswer"
    | "action"
    | "pairs"
    | "bindings"
    | "label"
    | "key"
    | "description"
    | "fillPolicy"
    | "choiceQuestion"
    | "newChoices"
    | "close"
    | "setReviewedContext"
  >;
  onNext?: () => void;
}

export function useCaptureActions({ captureId, state, onNext }: Props) {
  const updateCapture = useUpdateFormFillCapture();
  const applyCapture = useApplyFormFillCapture();
  const [announcement, setAnnouncement] = useState("");
  const {
    capture,
    question,
    actionValid,
    reviewed,
    selectedAnswer,
    action,
    pairs,
    bindings,
    label,
    key,
    description,
    fillPolicy,
    choiceQuestion,
    newChoices,
    close,
    setReviewedContext,
  } = state;

  async function apply(advance = false) {
    if (!capture || !question || !actionValid || !reviewed) return;
    const body = captureApplyRequest({
      capture,
      question,
      answer: selectedAnswer.data,
      action: action as Action,
      pairs,
      bindings,
      label,
      key,
      description,
      fillPolicy,
      choiceQuestion,
      newChoices,
    });
    try {
      await applyCapture.mutateAsync({ captureId, body });
      setAnnouncement(copy.captureDrawerMessages.rememberedValueAppliedToVerifiedKnowledge);
      toast.info(copy.captureDrawerMessages.rememberedValueApplied);
      if (advance && onNext) onNext();
      else close();
    } catch {
      setAnnouncement(copy.captureDrawerMessages.theRememberedValueWasNotApplied);
      setReviewedContext(null);
    }
  }

  async function changeStatus(status: "current" | "ignored") {
    if (!capture) return;
    try {
      await updateCapture.mutateAsync({
        captureId,
        body: { expected_revision: capture.revision, status },
      });
      setAnnouncement(
        status === "ignored"
          ? copy.captureDrawerMessages.rememberedValueIgnored
          : copy.captureDrawerMessages.rememberedValueReopened,
      );
      toast.info(
        status === "ignored"
          ? copy.captureDrawerMessages.rememberedValueDismissedAndCleared
          : copy.captureDrawerMessages.rememberedValueReopened,
      );
      if (status === "ignored") close();
    } catch {
      setAnnouncement(copy.captureDrawerMessages.theRememberedValueWasNotChanged);
    }
  }

  const busy = applyCapture.isPending || updateCapture.isPending;
  return { updateCapture, applyCapture, announcement, busy, apply, changeStatus };
}
