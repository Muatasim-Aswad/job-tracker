import { useCallback, useEffect, useRef, useState } from "react";
import { AnswerDrawer } from "./AnswerDrawer";
import { AnswerList } from "./AnswerList";
import { CaptureDrawer } from "./CaptureDrawer";
import { CaptureList } from "./CaptureList";
import { QuestionDrawer } from "./QuestionDrawer";
import { QuestionList } from "./QuestionList";
import { canLeaveFormFill } from "./draftGuard";
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
  const section = params.get("section");
  return {
    section:
      section === "answers"
        ? ("answers" as const)
        : section === "dismissed"
          ? ("dismissed" as const)
          : ("review" as const),
    reviewType: params.get("type") === "captures" ? ("captures" as const) : ("questions" as const),
    answerId: params.get("answer"),
    captureId: params.get("capture"),
    questionId: params.get("question"),
  };
}

export function FormFillWorkspace() {
  const [state, setState] = useState(readState);
  const [creatingAnswer, setCreatingAnswer] = useState(false);
  const [answerQuestion, setAnswerQuestion] = useState<QuestionDetail | null>(null);
  const [showAllQuestions, setShowAllQuestions] = useState(false);
  const inboxIds = useRef<string[]>([]);
  const rememberItems = useCallback((ids: string[]) => {
    inboxIds.current = ids;
  }, []);
  useEffect(() => {
    const onPopState = () => {
      setCreatingAnswer(false);
      setAnswerQuestion(null);
      setState(readState());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (removeNonViewState(url)) window.history.replaceState(null, "", url);
  }, []);

  const navigate = useCallback(
    (next: Partial<ReturnType<typeof readState>>, replace = false, handled = false) => {
      if (!handled && !canLeaveFormFill()) return false;
      const merged = { ...state, ...next };
      const url = new URL(window.location.href);
      url.searchParams.set("view", "form-fill");
      url.searchParams.set("section", merged.section);
      if (merged.section === "dismissed") url.searchParams.set("type", merged.reviewType);
      else url.searchParams.delete("type");
      for (const [key, value] of [
        ["answer", merged.answerId],
        ["capture", merged.captureId],
        ["question", merged.questionId],
      ] as const) {
        if (value) url.searchParams.set(key, value);
        else url.searchParams.delete(key);
      }
      removeNonViewState(url);
      window.history[replace ? "replaceState" : "pushState"](null, "", url);
      setState(merged);
      return true;
    },
    [state],
  );

  function openAnswer(answerId: string) {
    if (navigate({ section: "answers", answerId, captureId: null, questionId: null })) {
      setCreatingAnswer(false);
      setAnswerQuestion(null);
    }
  }
  function openQuestion(questionId: string) {
    navigate({ questionId, answerId: null, captureId: null });
  }
  function nextQuestion() {
    const next = inboxIds.current.find((id) => id !== (state.questionId ?? answerQuestion?.id));
    setCreatingAnswer(false);
    setAnswerQuestion(null);
    navigate(
      { section: "review", captureId: null, answerId: null, questionId: next ?? null },
      true,
      true,
    );
  }
  function createForQuestion(question: QuestionDetail) {
    if (!canLeaveFormFill()) return;
    setAnswerQuestion(question);
    setCreatingAnswer(true);
    navigate({ answerId: null, captureId: null, questionId: null }, true, true);
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6 overflow-y-auto p-4 sm:p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Form Fill</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          Choose the answers Job Tracker can reuse in application forms. Review new questions here;
          edit your saved answers anytime.
        </p>
      </header>
      <div
        role="tablist"
        aria-label="Form Fill sections"
        className="flex flex-wrap border-b border-line"
      >
        {(
          [
            ["review", "Review inbox"],
            ["answers", "Saved answers"],
            ["dismissed", "Dismissed"],
          ] as const
        ).map(([section, label]) => (
          <button
            key={section}
            type="button"
            role="tab"
            aria-selected={state.section === section}
            onClick={() => navigate({ section, answerId: null, captureId: null, questionId: null })}
            className={`border-b-2 px-4 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-accent ${state.section === section ? "border-accent text-ink" : "border-transparent text-ink-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {state.section === "answers" ? (
        <AnswerList
          onOpen={openAnswer}
          onCreate={() => {
            if (navigate({ answerId: null, captureId: null, questionId: null })) {
              setAnswerQuestion(null);
              setCreatingAnswer(true);
            }
          }}
        />
      ) : state.section === "dismissed" ? (
        <div className="space-y-5">
          <div role="tablist" aria-label="Dismissed items" className="flex gap-2">
            {(
              [
                ["questions", "Questions"],
                ["captures", "Remembered values"],
              ] as const
            ).map(([reviewType, label]) => (
              <button
                key={reviewType}
                type="button"
                role="tab"
                aria-selected={state.reviewType === reviewType}
                className={`rounded-md border border-line px-3 py-2 text-sm ${state.reviewType === reviewType ? "bg-surface-hover text-ink" : "text-ink-muted"}`}
                onClick={() => navigate({ reviewType, questionId: null, captureId: null })}
              >
                {label}
              </button>
            ))}
          </div>
          {state.reviewType === "captures" ? (
            <CaptureList onOpen={(captureId) => navigate({ captureId, questionId: null })} />
          ) : (
            <QuestionList mode="muted" onOpen={openQuestion} />
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={showAllQuestions}
              onChange={(event) => setShowAllQuestions(event.target.checked)}
            />
            Include questions already handled
          </label>
          <QuestionList
            key={showAllQuestions ? "all" : "inbox"}
            mode={showAllQuestions ? "all" : "inbox"}
            onOpen={openQuestion}
            onItemsChange={rememberItems}
          />
        </div>
      )}

      {(state.answerId || creatingAnswer) && (
        <AnswerDrawer
          key={state.answerId ?? answerQuestion?.id ?? "new"}
          answerId={state.answerId}
          questionContext={answerQuestion}
          onClose={() => {
            setCreatingAnswer(false);
            const questionId = answerQuestion?.id ?? null;
            setAnswerQuestion(null);
            navigate({ answerId: null, questionId }, true, true);
          }}
          onCreated={(answerId, advance) => {
            if (advance) {
              nextQuestion();
              return;
            }
            setCreatingAnswer(false);
            if (answerQuestion) {
              const questionId = answerQuestion.id;
              setAnswerQuestion(null);
              navigate({ questionId, answerId: null }, true, true);
            } else navigate({ section: "answers", answerId }, true, true);
          }}
          onOpenQuestion={openQuestion}
        />
      )}
      {state.captureId && (
        <CaptureDrawer
          key={state.captureId}
          captureId={state.captureId}
          onClose={() => navigate({ captureId: null }, true, true)}
          onOpenQuestion={openQuestion}
          onNext={state.section === "review" ? nextQuestion : undefined}
        />
      )}
      {state.questionId && !state.captureId && !creatingAnswer && (
        <QuestionDrawer
          key={state.questionId}
          questionId={state.questionId}
          onClose={() => navigate({ questionId: null }, true, true)}
          onCreateAnswer={createForQuestion}
          onOpenCapture={(captureId) => navigate({ captureId })}
          onNext={state.section === "review" ? nextQuestion : undefined}
        />
      )}
    </div>
  );
}
