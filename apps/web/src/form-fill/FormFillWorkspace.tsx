import { useCallback, useEffect, useState } from "react";
import { useFormFillReviewPresence } from "../hooks";
import { AnswerDrawer } from "./AnswerDrawer";
import { AnswerList } from "./AnswerList";
import { CaptureDrawer } from "./CaptureDrawer";
import { CaptureList } from "./CaptureList";
import { QuestionDrawer } from "./QuestionDrawer";
import { QuestionList } from "./QuestionList";
import type { QuestionDetail } from "./model";

const URL_KEYS = new Set(["view", "section", "type", "answer", "capture", "question"]);

function removeNonViewState(url: URL): boolean {
  let changed = false;
  for (const key of [...url.searchParams.keys()]) {
    if (!URL_KEYS.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  return changed;
}

function readState() {
  const params = new URLSearchParams(window.location.search);
  return {
    section: params.get("section") === "review" ? ("review" as const) : ("answers" as const),
    reviewType: params.get("type") === "questions" ? ("questions" as const) : ("captures" as const),
    answerId: params.get("answer"),
    captureId: params.get("capture"),
    questionId: params.get("question"),
  };
}

export function FormFillWorkspace() {
  const [state, setState] = useState(readState);
  const reviewPresence = useFormFillReviewPresence();
  const [creatingAnswer, setCreatingAnswer] = useState(false);
  const [answerQuestion, setAnswerQuestion] = useState<QuestionDetail | null>(null);

  useEffect(() => {
    const onPopState = () => setState(readState());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (
      state.section !== "review" ||
      params.has("type") ||
      reviewPresence.isLoading ||
      reviewPresence.hasCaptures ||
      !reviewPresence.hasQuestions
    ) {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("type", "questions");
    window.history.replaceState(null, "", url);
    setState((current) => ({ ...current, reviewType: "questions" }));
  }, [
    reviewPresence.hasCaptures,
    reviewPresence.hasQuestions,
    reviewPresence.isLoading,
    state.section,
  ]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (removeNonViewState(url)) window.history.replaceState(null, "", url);
  }, []);

  const navigate = useCallback(
    (next: Partial<ReturnType<typeof readState>>, replace = false) => {
      const merged = { ...state, ...next };
      const url = new URL(window.location.href);
      url.searchParams.set("view", "form-fill");
      url.searchParams.set("section", merged.section);
      if (merged.section === "review") url.searchParams.set("type", merged.reviewType);
      else url.searchParams.delete("type");
      for (const [key, value] of [
        ["answer", merged.answerId],
        ["capture", merged.captureId],
        ["question", merged.questionId],
      ] as const) {
        if (value) url.searchParams.set(key, value);
        else url.searchParams.delete(key);
      }
      // Resource IDs and enum view state are the only Form Fill URL state.
      removeNonViewState(url);
      window.history[replace ? "replaceState" : "pushState"](null, "", url);
      setState(merged);
    },
    [state],
  );

  function openAnswer(answerId: string) {
    setCreatingAnswer(false);
    setAnswerQuestion(null);
    navigate({ section: "answers", answerId, captureId: null, questionId: null });
  }
  function openCapture(captureId: string) {
    navigate({
      section: "review",
      reviewType: "captures",
      captureId,
      answerId: null,
      questionId: null,
    });
  }
  function openQuestion(questionId: string) {
    navigate({
      section: "review",
      reviewType: "questions",
      questionId,
      answerId: null,
      captureId: null,
    });
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-5 overflow-y-auto p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold text-ink">Form Fill</h1>
        <p className="text-sm text-ink-muted">
          Manage verified Answers and review provisional knowledge. Job Tracker never advances or
          submits an application.
        </p>
      </header>
      <div role="tablist" aria-label="Form Fill sections" className="flex border-b border-line">
        {(["answers", "review"] as const).map((section) => (
          <button
            key={section}
            type="button"
            role="tab"
            aria-selected={state.section === section}
            onClick={() => navigate({ section, answerId: null, captureId: null, questionId: null })}
            className={`border-b-2 px-4 py-2 text-sm font-medium ${state.section === section ? "border-accent text-ink" : "border-transparent text-ink-muted"}`}
          >
            {section === "answers" ? "Answers" : "Needs review"}
          </button>
        ))}
      </div>
      {state.section === "answers" ? (
        <AnswerList
          onOpen={openAnswer}
          onCreate={() => {
            setAnswerQuestion(null);
            setCreatingAnswer(true);
            navigate({ answerId: null, captureId: null, questionId: null });
          }}
        />
      ) : (
        <div className="space-y-5">
          <div
            role="tablist"
            aria-label="Needs review sections"
            className="inline-flex rounded-md border border-line bg-surface p-0.5"
          >
            {(["captures", "questions"] as const).map((type) => (
              <button
                key={type}
                type="button"
                role="tab"
                aria-selected={state.reviewType === type}
                onClick={() =>
                  navigate({ reviewType: type, answerId: null, captureId: null, questionId: null })
                }
                className={`rounded px-3 py-1.5 text-sm font-medium ${state.reviewType === type ? "bg-surface-hover text-ink" : "text-ink-muted"}`}
              >
                {type === "captures" ? "Remembered values" : "Unresolved Questions"}
              </button>
            ))}
          </div>
          {state.reviewType === "captures" ? (
            <CaptureList onOpen={openCapture} />
          ) : (
            <QuestionList onOpen={openQuestion} />
          )}
        </div>
      )}

      {(state.answerId || creatingAnswer) && (
        <AnswerDrawer
          answerId={state.answerId}
          questionContext={answerQuestion}
          onClose={() => {
            setCreatingAnswer(false);
            if (answerQuestion) {
              const questionId = answerQuestion.id;
              setAnswerQuestion(null);
              navigate(
                {
                  section: "review",
                  reviewType: "questions",
                  answerId: null,
                  questionId,
                },
                true,
              );
            } else {
              navigate({ answerId: null }, true);
            }
          }}
          onCreated={(answerId) => {
            if (answerQuestion) {
              const questionId = answerQuestion.id;
              setAnswerQuestion(null);
              setCreatingAnswer(false);
              navigate(
                { section: "review", reviewType: "questions", answerId: null, questionId },
                true,
              );
            } else {
              navigate({ section: "answers", answerId }, true);
            }
          }}
          onOpenQuestion={openQuestion}
        />
      )}
      {state.captureId && (
        <CaptureDrawer
          captureId={state.captureId}
          onClose={() => navigate({ captureId: null }, true)}
          onOpenQuestion={openQuestion}
        />
      )}
      {state.questionId && !creatingAnswer && (
        <QuestionDrawer
          questionId={state.questionId}
          onClose={() => navigate({ questionId: null }, true)}
          onCreateAnswer={(question) => {
            setAnswerQuestion(question);
            setCreatingAnswer(true);
            navigate({ answerId: null, questionId: null }, true);
          }}
        />
      )}
    </div>
  );
}
