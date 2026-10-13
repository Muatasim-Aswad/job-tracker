import { afterEach, describe, expect, it } from "vitest";
import { EasyApplyRootFinder, LAUNCH_WINDOW_MS } from "./root";

const question = `<label for="q">Preferred name</label><input id="q" type="text">`;

function clock(start = 1_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("Easy Apply root discovery", () => {
  it.each([
    ["legacy modal class", `<div class="jobs-easy-apply-modal" role="dialog">${question}</div>`],
    ["legacy test marker", `<div data-test-easy-apply-modal role="dialog">${question}</div>`],
    [
      "SDUI screen",
      `<dialog open><div data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.easyapply.EasyApply">${question}</div></dialog>`,
    ],
    [
      "SDUI field key",
      `<div role="dialog" aria-modal="true"><div componentkey="easyApplyFieldFocus_ea_validation_1">${question}</div></div>`,
    ],
  ])("accepts an open dialog marked by its %s", (_, html) => {
    document.body.innerHTML = html;
    const found = new EasyApplyRootFinder(document).find();

    expect(found?.matches('dialog, [role="dialog"]')).toBe(true);
  });

  it("ignores unmarked dialogs, marked content outside dialogs, and dialogs without fields", () => {
    document.body.innerHTML = `
      <div role="dialog" aria-label="Messaging">${question}</div>
      <div class="jobs-easy-apply-modal">${question}</div>
      <div role="dialog" class="jobs-easy-apply-modal"><button>Discard</button></div>
      <dialog class="jobs-easy-apply-modal">${question}</dialog>`;

    expect(new EasyApplyRootFinder(document).find()).toBeNull();
  });

  it("finds a marked dialog inside an open shadow root", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<div role="dialog" class="jobs-easy-apply-modal">${question}</div>`;

    expect(new EasyApplyRootFinder(document).find()).toBe(shadow.querySelector('[role="dialog"]'));
  });

  it("adopts only a new dialog that opens soon after an Easy Apply launcher", () => {
    const time = clock();
    document.body.innerHTML = `
      <div role="dialog" id="existing">${question}</div>
      <button aria-label="Easy Apply to Example Co"><span>Apply</span></button>`;
    const finder = new EasyApplyRootFinder(document, time.now);
    finder.noteActivation(document.querySelector("span")!);
    expect(finder.find()).toBeNull();

    document.body.insertAdjacentHTML("beforeend", `<div role="dialog" id="launched"></div>`);
    expect(finder.find()).toBeNull();
    document.querySelector("#launched")!.innerHTML = question;
    time.advance(LAUNCH_WINDOW_MS);

    expect(finder.find()?.id).toBe("launched");
    time.advance(60_000);
    expect(finder.find()?.id).toBe("launched");
  });

  it("ignores activations that are not Easy Apply and launches that expired", () => {
    const time = clock();
    document.body.innerHTML = `<button>Save</button><button>Easy Apply</button>`;
    const finder = new EasyApplyRootFinder(document, time.now);

    finder.noteActivation(document.querySelectorAll("button")[0]);
    document.body.insertAdjacentHTML("beforeend", `<div role="dialog">${question}</div>`);
    expect(finder.find()).toBeNull();

    document.querySelector('[role="dialog"]')!.remove();
    finder.noteActivation(document.querySelectorAll("button")[1]);
    time.advance(LAUNCH_WINDOW_MS + 1);
    document.body.insertAdjacentHTML("beforeend", `<div role="dialog">${question}</div>`);
    expect(finder.find()).toBeNull();
  });
});
