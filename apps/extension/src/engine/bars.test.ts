import { beforeEach, describe, expect, it, vi } from "vitest";

import { canSkip, createBars, isListDeemphasized } from "./bars";
import type { Adapter } from "../adapters/types";
import type { Engine } from "./types";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("list-card display state", () => {
  it.each(["to_apply", "applied", "in_process", "offered", "skipped", "rejected"])(
    "deemphasizes %s without requiring a hidden flag",
    (status) => {
      expect(isListDeemphasized(status)).toBe(true);
    },
  );

  it.each(["untracked", "new", "seen"])("keeps %s in discovery lists", (status) => {
    expect(isListDeemphasized(status)).toBe(false);
  });
});

describe("skip eligibility", () => {
  it.each(["untracked", "new", "seen", "to_apply"])("allows %s", (status) => {
    expect(canSkip(status)).toBe(true);
  });

  it.each(["applied", "in_process", "offered", "skipped", "closed", "withdrawn", "rejected"])(
    "protects %s",
    (status) => {
      expect(canSkip(status)).toBe(false);
    },
  );
});

describe("hidden flag action", () => {
  it.each([
    [false, "hidden"],
    [true, "unhidden"],
  ])("toggles hidden=%s with %s", async (hidden, event) => {
    const emit = vi.fn(async () => null);
    const engine = {
      stateOf: () => ({ status: "seen", hidden, starred: false }),
      emit,
    } as unknown as Engine;

    await createBars(engine).toggleHidden("LI-1");

    expect(emit).toHaveBeenCalledWith("LI-1", event);
  });
});

function actionEngine(status: string) {
  const state = { status, hidden: false, starred: false };
  const emit = vi.fn(async (_jobId: string, event: string) => {
    if (event === "skipped") state.status = "skipped";
    return { ...state };
  });
  const engine = {
    stateOf: () => state,
    emit,
    makeStatusSelect: () => document.createElement("select"),
    syncStatusSelect: vi.fn(),
    pinSelectTheme: vi.fn(),
    isCardBlocked: () => false,
    decorateOffline: vi.fn(),
    captureCardFromAction: vi.fn(),
    mkOverflowButton: () => document.createElement("button"),
    matchCompany: () => null,
  } as unknown as Engine;
  return { engine, emit, state };
}

describe("discovery-card actions", () => {
  it("replaces Hide and Dismiss with one Skip action", () => {
    const { engine, emit } = actionEngine("seen");
    const nativeDismiss = vi.fn();
    const adapter: Adapter = {
      matches: () => true,
      findCards: () => [],
      nativeDismiss: () => nativeDismiss,
    };
    const card = document.body.appendChild(document.createElement("article"));
    card.dataset.jhId = "LI-1";

    createBars(engine).injectButtons(card, adapter);

    expect(card.querySelector(".jh-btn-hide")).toBeNull();
    expect(card.querySelector(".jh-btn-dismiss")).toBeNull();
    const skip = card.querySelector(".jh-btn-skip") as HTMLButtonElement;
    expect(skip.title).toBe("Skip job");

    skip.click();

    expect(engine.captureCardFromAction).toHaveBeenCalledWith(card);
    expect(emit).toHaveBeenCalledWith("LI-1", "skipped");
    expect(nativeDismiss).toHaveBeenCalledOnce();
  });

  it("hides Skip and refuses dismissal after application", () => {
    const { engine, emit } = actionEngine("applied");
    const nativeDismiss = vi.fn();
    const adapter: Adapter = {
      matches: () => true,
      findCards: () => [],
      nativeDismiss: () => nativeDismiss,
    };
    const card = document.body.appendChild(document.createElement("article"));
    card.dataset.jhId = "LI-2";

    const bars = createBars(engine);
    bars.injectButtons(card, adapter);
    const skip = card.querySelector(".jh-btn-skip") as HTMLButtonElement;

    expect(skip.hidden).toBe(true);
    expect(bars.skipJob("LI-2", nativeDismiss)).toBeNull();
    expect(emit).not.toHaveBeenCalled();
    expect(nativeDismiss).not.toHaveBeenCalled();
  });
});

describe("expanded-view actions", () => {
  it("shows both Hide and Skip before application", () => {
    const { engine } = actionEngine("seen");
    const anchor = document.body.appendChild(document.createElement("div"));

    createBars(engine).injectDetailButtons("LI-1", anchor);

    const bar = document.querySelector(".jh-detail-actions")!;
    expect(bar.querySelector(".jh-btn-hide")).not.toBeNull();
    expect((bar.querySelector(".jh-btn-skip") as HTMLButtonElement).hidden).toBe(false);
  });

  it("keeps Hide but hides Skip after application", () => {
    const { engine } = actionEngine("in_process");
    const anchor = document.body.appendChild(document.createElement("div"));

    createBars(engine).injectDetailButtons("LI-1", anchor);

    const bar = document.querySelector(".jh-detail-actions")!;
    expect(bar.querySelector(".jh-btn-hide")).not.toBeNull();
    expect((bar.querySelector(".jh-btn-skip") as HTMLButtonElement).hidden).toBe(true);
  });
});
