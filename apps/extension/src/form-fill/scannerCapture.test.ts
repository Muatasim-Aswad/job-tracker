import { afterEach, expect, it, vi } from "vitest";
import type {
  FormFillCaptureRequest,
  FormFillCaptureResponse,
  FormFillResolutionRequest,
} from "../messages.js";
import { EasyApplyScanner } from "./scanner.js";

function fixture(): HTMLInputElement[] {
  history.replaceState({}, "", "/jobs/view/example-123456/");
  document.body.innerHTML = `
    <div class="jobs-easy-apply-modal" role="dialog">
      <h3>Screening questions</h3>
      ${[1, 2, 3]
        .map(
          (number) => `<div data-test-form-element>
            <label for="question-${number}-text">Question ${number}</label>
            <input id="question-${number}-text" type="text">
          </div>`,
        )
        .join("")}
    </div>`;
  return [...document.querySelectorAll<HTMLInputElement>("input")];
}

function edit(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  history.replaceState({}, "", "/");
});

it("serializes shared-Question handles while an independent Question saves through a failure", async () => {
  vi.useFakeTimers();
  const inputs = fixture();
  const completions: (() => void)[] = [];
  const captureBridge = vi.fn(
    (_request: FormFillCaptureRequest) =>
      new Promise<{ ok: true; result: FormFillCaptureResponse }>((resolve, reject) => {
        const first = completions.length === 0;
        completions.push(() => {
          if (first) reject(new Error("synthetic transport failure"));
          else resolve({ ok: true, result: { capture: {} } as FormFillCaptureResponse });
        });
      }),
  );
  const scanner = new EasyApplyScanner(document, {
    isUserEvent: () => true,
    captureSettleMs: 20,
    settleMs: 60_000,
    captureBridge,
    bridge: async (request: FormFillResolutionRequest) => ({
      ok: true,
      result: {
        scan_id: request.scan_id,
        listing_context: { job_id: null, listing_id: null },
        results: request.fields.map((field, index) => ({
          status: "unresolved",
          client_field_id: field.client_field_id,
          question_id: index < 2 ? "shared-question" : "independent-question",
          reason: "no_knowledge",
          option_mappings: [],
        })),
      },
    }),
  });
  scanner.setEnabled(true);
  try {
    await scanner.scan();
    edit(inputs[0], "first");
    await vi.advanceTimersByTimeAsync(20);
    edit(inputs[1], "second");
    edit(inputs[2], "independent");
    await vi.advanceTimersByTimeAsync(20);

    expect(captureBridge.mock.calls.map(([request]) => request.question_id)).toEqual([
      "shared-question",
      "independent-question",
    ]);
    completions[1]();
    await vi.advanceTimersByTimeAsync(0);
    await scanner.scan();
    expect(document.body.textContent).toContain("Remembered for this exact question");
    expect(captureBridge).toHaveBeenCalledTimes(2);

    completions[0]();
    await vi.advanceTimersByTimeAsync(0);
    expect(captureBridge).toHaveBeenCalledTimes(3);
    expect(captureBridge.mock.calls[2][0]).toMatchObject({
      question_id: "shared-question",
      cleared: false,
      value: { kind: "text", value: "second" },
    });
    expect(captureBridge.mock.calls[2][0].capture_key).not.toBe(
      captureBridge.mock.calls[0][0].capture_key,
    );
    completions[2]();
    await vi.advanceTimersByTimeAsync(0);
    await scanner.scan();
    const summary = document
      .querySelector("[data-jh-ff-panel]")!
      .shadowRoot!.querySelector(".summary")!.textContent;
    expect(summary).toContain("2 remembered");
    expect(inputs.map((input) => input.value)).toEqual(["first", "second", "independent"]);
  } finally {
    scanner.setEnabled(false);
  }
});
