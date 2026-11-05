import type { AnswerDetail, CaptureDetail, QuestionDetail } from "./model";

interface ReviewContext {
  draft: string;
  question: QuestionDetail | undefined;
  selectedAnswer: AnswerDetail | undefined;
  currentAnswer: AnswerDetail | undefined;
  captures: { data: CaptureDetail | undefined }[];
}

export function questionReviewContext({
  draft,
  question,
  selectedAnswer,
  currentAnswer,
  captures,
}: ReviewContext): string {
  return JSON.stringify({
    draft,
    question: [question?.id, question?.revision],
    mapping: [question?.mapping?.id, question?.mapping?.revision],
    answer: [selectedAnswer?.id, selectedAnswer?.revision],
    currentAnswer: [
      question?.answer?.id,
      question?.answer?.revision,
      currentAnswer?.id,
      currentAnswer?.revision,
    ],
    captureSummaries: question?.current_captures?.map((capture) => [capture.id, capture.revision]),
    captures: captures.map((capture) => [capture.data?.id, capture.data?.revision]),
  });
}

interface AnswerSnapshot {
  data: AnswerDetail | undefined;
  isError: boolean;
}

interface MatchReviewReadiness {
  question: QuestionDetail | undefined;
  questionFailed: boolean;
  selectedAnswer: AnswerSnapshot;
  currentAnswer: AnswerSnapshot;
  complete: boolean;
  captures: { data: CaptureDetail | undefined; isError: boolean }[];
}

export function canReviewQuestionMatch({
  question,
  questionFailed,
  selectedAnswer,
  currentAnswer,
  complete,
  captures,
}: MatchReviewReadiness): boolean {
  return (
    !!question &&
    !questionFailed &&
    !!selectedAnswer.data &&
    !selectedAnswer.isError &&
    complete &&
    captures.every((capture) => !!capture.data && !capture.isError) &&
    (question.current_captures ?? []).every((summary) =>
      captures.some(
        (capture) => capture.data?.id === summary.id && capture.data.revision >= summary.revision,
      ),
    ) &&
    !question.capture_conflict &&
    (!question.answer ||
      (!!currentAnswer.data &&
        !currentAnswer.isError &&
        currentAnswer.data.revision >= question.answer.revision))
  );
}
