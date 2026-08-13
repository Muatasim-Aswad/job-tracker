import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  FormFillCaptureRequest,
  FormFillCaptureResponse,
  FormFillResolutionRequest,
  FormFillResolutionResponse,
} from "../messages";
import { EasyApplyScanner } from "./scanner";

const field = (number: number, prompt: string, value = "") => `
  <div data-test-form-element>
    <label for="single-line-text-form-component-formElement-urn-li-jobs-applyformcommon-easyApplyFormElement-123456-${number}-text">${prompt}</label>
    <input id="single-line-text-form-component-formElement-urn-li-jobs-applyformcommon-easyApplyFormElement-123456-${number}-text" type="text" value="${value}">
  </div>`;

function fixture(contents: string, actions = "") {
  history.replaceState({}, "", "/jobs/view/example-123456/");
  document.body.innerHTML = `
    <div class="jobs-easy-apply-modal">
      <h3>Screening questions</h3>
      ${contents}
      <footer>${actions}</footer>
    </div>`;
}

function response(
  request: FormFillResolutionRequest,
  results: FormFillResolutionResponse["results"],
): FormFillResolutionResponse {
  return {
    scan_id: request.scan_id,
    listing_context: { job_id: null, listing_id: null },
    results,
  };
}

function unresolved(clientFieldId: string): FormFillResolutionResponse["results"][number] {
  return {
    status: "unresolved",
    client_field_id: clientFieldId,
    question_id: `question-${clientFieldId}`,
    reason: "no_knowledge",
    option_mappings: [],
  };
}

const ids = () => {
  let count = 0;
  return () => `runtime-${++count}`;
};

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

describe("generation-based safe form filling", () => {
  it("waits for lazy fields to settle and resolves one batch", async () => {
    vi.useFakeTimers();
    fixture("");
    const bridge = vi.fn(async (request: FormFillResolutionRequest) => ({
      ok: true as const,
      result: response(
        request,
        request.fields.map((item) => unresolved(item.client_field_id)),
      ),
    }));
    const scanner = new EasyApplyScanner(document, { id: ids(), bridge, settleMs: 180 });
    scanner.setEnabled(true);
    await vi.advanceTimersByTimeAsync(100);
    document.querySelector("footer")!.insertAdjacentHTML("beforebegin", field(1, "Lazy question"));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(179);
    expect(bridge).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(bridge).toHaveBeenCalledOnce();
    expect(bridge.mock.calls[0][0].fields.map((item) => item.prompt)).toEqual(["Lazy question"]);
    scanner.setEnabled(false);
  });

  it("batches fields in DOM order and renders independent result states", async () => {
    fixture(field(1, "First question") + field(2, "Second question"));
    const requests: FormFillResolutionRequest[] = [];
    const scanner = new EasyApplyScanner(document, {
      id: ids(),
      settleMs: 60_000,
      bridge: async (request) => {
        requests.push(request);
        return { ok: true, result: response(request, [unresolved("field-1")]) };
      },
    });
    scanner.setEnabled(true);
    await scanner.scan();

    expect(requests).toHaveLength(1);
    expect(requests[0].page).toEqual({
      platform: "linkedin",
      platform_id: "123456",
      site_scope: "linkedin:easy-apply",
      adapter_id: "linkedin.easy_apply",
      adapter_version: "1",
    });
    expect(requests[0].fields.map((requestField) => requestField.prompt)).toEqual([
      "First question",
      "Second question",
    ]);
    const markers = [...document.querySelectorAll<HTMLElement>(".jh-ff-marker")];
    expect(markers.map((marker) => marker.dataset.state)).toEqual(["unresolved", "error"]);
    const panel = document.querySelector<HTMLElement>("[data-jh-ff-panel]")!.shadowRoot!;
    expect(panel.textContent).toContain(
      "0 filled · 0 already match · 2 needs attention · 0 manual",
    );
    expect(panel.textContent).toContain("Job Tracker never continues or submits");
    scanner.setEnabled(false);
  });

  it("discards a stale response after a newer generation settles", async () => {
    fixture(field(1, "Current question"));
    let releaseFirst:
      | ((value: { ok: true; result: FormFillResolutionResponse }) => void)
      | undefined;
    let calls = 0;
    const scanner = new EasyApplyScanner(document, {
      id: ids(),
      settleMs: 60_000,
      bridge: (request) => {
        calls += 1;
        if (calls === 1) {
          return new Promise((resolve) => {
            releaseFirst = resolve;
          });
        }
        return Promise.resolve({ ok: true, result: response(request, [unresolved("field-1")]) });
      },
    });
    scanner.setEnabled(true);
    const oldScan = scanner.scan();
    await scanner.scan();
    expect(document.querySelector<HTMLElement>(".jh-ff-marker")?.dataset.state).toBe("unresolved");
    const oldRequest: FormFillResolutionRequest = {
      application_context_id: "runtime-1",
      scan_id: "runtime-2",
      page: {
        platform: "linkedin",
        platform_id: "123456",
        site_scope: "linkedin:easy-apply",
        adapter_id: "linkedin.easy_apply",
        adapter_version: "1",
      },
      fields: [],
    };
    releaseFirst?.({
      ok: true,
      result: response(oldRequest, [
        {
          status: "approved",
          client_field_id: "field-1",
          question_id: "question-field-1",
          answer_id: "answer-1",
          answer_revision: 1,
          mapping_id: "mapping-1",
          mapping_revision: 1,
          action: { kind: "set_text", value: "synthetic-answer" },
          option_mappings: [],
        },
      ]),
    });
    await oldScan;
    expect(document.querySelector<HTMLElement>(".jh-ff-marker")?.dataset.state).toBe("unresolved");
    scanner.setEnabled(false);
  });

  it("keeps later same-step fields local as unproven conditional controls", async () => {
    fixture(field(1, "Initial question"));
    const requests: FormFillResolutionRequest[] = [];
    const scanner = new EasyApplyScanner(document, {
      id: ids(),
      settleMs: 60_000,
      bridge: async (request) => {
        requests.push(request);
        return {
          ok: true,
          result: response(
            request,
            request.fields.map((item) => unresolved(item.client_field_id)),
          ),
        };
      },
    });
    scanner.setEnabled(true);
    await scanner.scan();
    document
      .querySelector("footer")!
      .insertAdjacentHTML("beforebegin", field(2, "Conditional question"));
    await Promise.resolve();
    await scanner.scan();

    expect(requests[1].fields.map((item) => item.prompt)).toEqual(["Initial question"]);
    expect(document.body.textContent).toContain("Complete this manually");
    const panel = document.querySelector<HTMLElement>("[data-jh-ff-panel]")!.shadowRoot!;
    expect(panel.textContent).toContain("A conditional question appeared after this step loaded.");
    scanner.setEnabled(false);
  });

  it("resets the supported baseline when the host advances to another step", async () => {
    fixture(field(1, "First-step question"));
    const requests: FormFillResolutionRequest[] = [];
    const scanner = new EasyApplyScanner(document, {
      id: ids(),
      settleMs: 60_000,
      bridge: async (request) => {
        requests.push(request);
        return {
          ok: true,
          result: response(
            request,
            request.fields.map((item) => unresolved(item.client_field_id)),
          ),
        };
      },
    });
    scanner.setEnabled(true);
    await scanner.scan();
    document.querySelector("h3")!.textContent = "Next screening step";
    document.querySelector("[data-test-form-element]")!.outerHTML = field(
      2,
      "Second-step question",
    );
    await Promise.resolve();
    await scanner.scan();

    expect(requests[1].fields.map((item) => item.prompt)).toEqual(["Second-step question"]);
    expect(document.body.textContent).not.toContain("Complete this manually");
    scanner.setEnabled(false);
  });

  it("preserves an existing value and never invokes host navigation or document actions", async () => {
    fixture(
      field(1, "Existing answer", "synthetic-existing"),
      `<button data-easy-apply-next-button>Next</button>
       <button aria-label="Review your application">Review</button>
       <button aria-label="Submit application">Submit</button>
       <button aria-label="Select résumé">Résumé</button>
       <button aria-label="Accept consent">Consent</button>
       <button aria-label="Edit profile">Edit profile</button>`,
    );
    const input = document.querySelector<HTMLInputElement>("input")!;
    const before = input.value;
    const click = vi.spyOn(HTMLElement.prototype, "click");
    const setValue = vi.spyOn(HTMLInputElement.prototype, "value", "set");

    const scanner = new EasyApplyScanner(document, {
      id: ids(),
      settleMs: 60_000,
      bridge: async (request) => ({
        ok: true,
        result: response(request, [
          {
            status: "approved",
            client_field_id: "field-1",
            question_id: "question-1",
            answer_id: "answer-1",
            answer_revision: 1,
            mapping_id: "mapping-1",
            mapping_revision: 1,
            action: { kind: "set_text", value: "synthetic-answer" },
            option_mappings: [],
          },
        ]),
      }),
    });
    scanner.setEnabled(true);
    await scanner.scan();

    expect(input.value).toBe(before);
    expect(setValue).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("synthetic-answer");
    expect(
      document.querySelector<HTMLElement>("[data-jh-ff-panel]")!.shadowRoot!.textContent,
    ).not.toContain("synthetic-answer");
    scanner.setEnabled(false);
  });

  it("fills an empty text field natively, verifies it, and reverts only its owned value", async () => {
    fixture(
      field(1, "Empty answer"),
      `<button data-easy-apply-next-button>Next</button>
       <button aria-label="Review your application">Review</button>
       <button aria-label="Submit application">Submit</button>
       <button aria-label="Select résumé">Résumé</button>
       <button aria-label="Accept consent">Consent</button>
       <button aria-label="Edit profile">Edit profile</button>`,
    );
    const input = document.querySelector<HTMLInputElement>("input")!;
    const inputEvents: string[] = [];
    input.addEventListener("input", () => inputEvents.push("input"));
    input.addEventListener("change", () => inputEvents.push("change"));
    const hostActions = [...document.querySelectorAll<HTMLButtonElement>("footer button")];
    const hostAction = vi.fn();
    hostActions.forEach((button) => button.addEventListener("click", hostAction));
    const captureBridge = vi.fn();
    const scanner = new EasyApplyScanner(document, {
      id: ids(),
      settleMs: 60_000,
      captureBridge,
      bridge: async (request) => ({
        ok: true,
        result: response(request, [
          {
            status: "approved",
            client_field_id: "field-1",
            question_id: "question-1",
            answer_id: "answer-1",
            answer_revision: 1,
            mapping_id: "mapping-1",
            mapping_revision: 1,
            action: { kind: "set_text", value: "synthetic-answer" },
            option_mappings: [],
          },
        ]),
      }),
    });
    scanner.setEnabled(true);
    await scanner.scan();

    expect(input.value).toBe("synthetic-answer");
    expect(inputEvents).toEqual(["input", "change"]);
    expect(captureBridge).not.toHaveBeenCalled();
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    expect(captureBridge).not.toHaveBeenCalled();
    expect(hostAction).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLElement>(".jh-ff-marker")?.dataset.state).toBe("filled");

    const panel = document.querySelector<HTMLElement>("[data-jh-ff-panel]")!.shadowRoot!;
    const revert = [...panel.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Revert",
    )!;
    revert.click();
    expect(input.value).toBe("");
    expect(hostAction).not.toHaveBeenCalled();
    scanner.setEnabled(false);
  });

  it("requires an explicit replacement and loses ownership after a later change", async () => {
    fixture(field(1, "Current answer", "host-value"));
    const input = document.querySelector<HTMLInputElement>("input")!;
    const scanner = new EasyApplyScanner(document, {
      id: ids(),
      settleMs: 60_000,
      bridge: async (request) => ({
        ok: true,
        result: response(request, [
          {
            status: "approved",
            client_field_id: "field-1",
            question_id: "question-1",
            answer_id: "answer-1",
            answer_revision: 1,
            mapping_id: "mapping-1",
            mapping_revision: 1,
            action: { kind: "set_text", value: "verified-value" },
            option_mappings: [],
          },
        ]),
      }),
      captureBridge: async () => ({ ok: false }),
    });
    scanner.setEnabled(true);
    await scanner.scan();
    expect(input.value).toBe("host-value");
    expect(document.querySelector<HTMLElement>(".jh-ff-marker")?.dataset.state).toBe("differs");

    const panel = document.querySelector<HTMLElement>("[data-jh-ff-panel]")!.shadowRoot!;
    [...panel.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Use my answer")!
      .click();
    expect(input.value).toBe("verified-value");

    input.value = "later-user-value";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    const staleRevert = [...panel.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Revert",
    );
    staleRevert?.click();
    expect(input.value).toBe("later-user-value");
    scanner.setEnabled(false);
  });

  it("captures one settled external change, never captures its own fill, and clears value-free", async () => {
    vi.useFakeTimers();
    fixture(field(1, "Remember me"));
    const captureBridge = vi.fn(async (_request: FormFillCaptureRequest) => ({
      ok: true as const,
      result: { capture: {} } as FormFillCaptureResponse,
    }));
    const scanner = new EasyApplyScanner(document, {
      id: ids(),
      settleMs: 60_000,
      captureSettleMs: 20,
      captureBridge,
      bridge: async (request) => ({
        ok: true,
        result: response(request, [unresolved("field-1")]),
      }),
    });
    scanner.setEnabled(true);
    await scanner.scan();
    const input = document.querySelector<HTMLInputElement>("input")!;

    input.value = "user-entered-value";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    await vi.advanceTimersByTimeAsync(20);
    expect(captureBridge).toHaveBeenCalledOnce();
    expect(captureBridge.mock.calls[0][0]).toMatchObject({
      question_id: "question-field-1",
      source: "unattributed_change",
      cleared: false,
      value: { kind: "text", value: "user-entered-value" },
    });
    const stableKey = captureBridge.mock.calls[0][0].capture_key;

    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    await vi.advanceTimersByTimeAsync(20);
    expect(captureBridge).toHaveBeenCalledOnce();
    expect(stableKey).toBeTruthy();

    input.value = "";
    input.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(captureBridge).toHaveBeenCalledTimes(2);
    expect(captureBridge.mock.calls[1][0]).toMatchObject({ cleared: true, value: null });
    expect(JSON.stringify(captureBridge.mock.calls[1][0])).not.toContain("user-entered-value");
    scanner.setEnabled(false);
  });

  it("does not remember a prefilled value until Remember existing is explicit", async () => {
    fixture(field(1, "Prefilled answer", "external-value"));
    const captureBridge = vi.fn(async (_request: FormFillCaptureRequest) => ({
      ok: true as const,
      result: { capture: {} } as FormFillCaptureResponse,
    }));
    const scanner = new EasyApplyScanner(document, {
      id: ids(),
      settleMs: 60_000,
      captureBridge,
      bridge: async (request) => ({
        ok: true,
        result: response(request, [unresolved("field-1")]),
      }),
    });
    scanner.setEnabled(true);
    await scanner.scan();
    expect(captureBridge).not.toHaveBeenCalled();

    const panel = document.querySelector<HTMLElement>("[data-jh-ff-panel]")!.shadowRoot!;
    [...panel.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Remember existing")!
      .click();
    await vi.waitFor(() => expect(captureBridge).toHaveBeenCalledOnce());
    expect(captureBridge.mock.calls[0][0]).toMatchObject({
      source: "confirmed_external",
      value: { kind: "text", value: "external-value" },
    });
    scanner.setEnabled(false);
  });

  it("rechecks the live value before an explicit replacement", async () => {
    fixture(field(1, "Race checked", "first-host-value"));
    const scanner = new EasyApplyScanner(document, {
      id: ids(),
      settleMs: 60_000,
      bridge: async (request) => ({
        ok: true,
        result: response(request, [
          {
            status: "approved",
            client_field_id: "field-1",
            question_id: "question-1",
            answer_id: "answer-1",
            answer_revision: 1,
            mapping_id: "mapping-1",
            mapping_revision: 1,
            action: { kind: "set_text", value: "verified-value" },
            option_mappings: [],
          },
        ]),
      }),
    });
    scanner.setEnabled(true);
    await scanner.scan();
    const input = document.querySelector<HTMLInputElement>("input")!;
    input.value = "racing-host-value";
    const panel = document.querySelector<HTMLElement>("[data-jh-ff-panel]")!.shadowRoot!;
    [...panel.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Use my answer")!
      .click();
    expect(input.value).toBe("racing-host-value");
    expect(document.querySelector<HTMLElement>(".jh-ff-marker")?.dataset.state).toBe("failed");
    scanner.setEnabled(false);
  });

  it("fills select and Yes/No radio actions by request-local option identity", async () => {
    fixture(`
      <div data-test-form-element>
        <label for="select-123456-multipleChoice">Work preference</label>
        <select id="select-123456-multipleChoice" required>
          <option value="Choose">Choose</option>
          <option value="alpha">Option Alpha</option>
          <option value="beta">Option Beta</option>
        </select>
      </div>
      <div data-test-form-element>
        <fieldset><legend>Authorized?</legend>
          <label><input id="radio-123456-0" type="radio" name="auth">Yes</label>
          <label><input id="radio-123456-1" type="radio" name="auth">No</label>
        </fieldset>
      </div>`);
    const scanner = new EasyApplyScanner(document, {
      id: ids(),
      settleMs: 60_000,
      bridge: async (request) => ({
        ok: true,
        result: response(request, [
          {
            status: "approved",
            client_field_id: "field-1",
            question_id: "question-select",
            answer_id: "answer-select",
            answer_revision: 1,
            mapping_id: "mapping-select",
            mapping_revision: 1,
            action: { kind: "set_single_choice", client_option_id: "field-1-option-2" },
            option_mappings: [
              { client_option_id: "field-1-option-1", question_option_id: "option-alpha" },
              { client_option_id: "field-1-option-2", question_option_id: "option-beta" },
            ],
          },
          {
            status: "approved",
            client_field_id: "field-2",
            question_id: "question-radio",
            answer_id: "answer-radio",
            answer_revision: 1,
            mapping_id: "mapping-radio",
            mapping_revision: 1,
            action: { kind: "set_single_choice", client_option_id: "field-2-option-1" },
            option_mappings: [
              { client_option_id: "field-2-option-1", question_option_id: "option-yes" },
              { client_option_id: "field-2-option-2", question_option_id: "option-no" },
            ],
          },
        ]),
      }),
    });
    scanner.setEnabled(true);
    await scanner.scan();

    expect(document.querySelector<HTMLSelectElement>("select")!.value).toBe("beta");
    expect(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')[0].checked).toBe(
      true,
    );
    expect(
      [...document.querySelectorAll<HTMLElement>(".jh-ff-marker")].map(
        (marker) => marker.dataset.state,
      ),
    ).toEqual(["filled", "filled"]);
    scanner.setEnabled(false);
  });

  it("distinguishes agreement and a provisional remembered fill without overwriting", async () => {
    fixture(field(1, "Agreement", "same-value") + field(2, "Remembered blank"));
    const setValue = vi.spyOn(HTMLInputElement.prototype, "value", "set");
    const scanner = new EasyApplyScanner(document, {
      id: ids(),
      settleMs: 60_000,
      bridge: async (request) => ({
        ok: true,
        result: response(request, [
          {
            status: "approved",
            client_field_id: "field-1",
            question_id: "question-agreement",
            answer_id: "answer-agreement",
            answer_revision: 1,
            mapping_id: "mapping-agreement",
            mapping_revision: 1,
            action: { kind: "set_text", value: "same-value" },
            option_mappings: [],
          },
          {
            status: "captured",
            client_field_id: "field-2",
            question_id: "question-remembered",
            capture_id: "capture-remembered",
            capture_revision: 1,
            source: "user_input",
            action: { kind: "set_text", value: "remembered-value" },
            option_mappings: [],
          },
        ]),
      }),
    });
    scanner.setEnabled(true);
    await scanner.scan();
    expect(
      [...document.querySelectorAll<HTMLInputElement>("input")].map((input) => input.value),
    ).toEqual(["same-value", "remembered-value"]);
    expect(setValue).toHaveBeenCalledTimes(1);
    expect(
      [...document.querySelectorAll<HTMLElement>(".jh-ff-marker")].map(
        (marker) => marker.dataset.state,
      ),
    ).toEqual(["already", "remembered"]);
    scanner.setEnabled(false);
  });

  it("captures a direct choice with its server-owned option identity", async () => {
    fixture(`
      <div data-test-form-element>
        <label for="select-123456-multipleChoice">Work preference</label>
        <select id="select-123456-multipleChoice" required>
          <option value="Choose">Choose</option>
          <option value="alpha">Option Alpha</option>
          <option value="beta">Option Beta</option>
        </select>
      </div>`);
    const captureBridge = vi.fn(async (_request: FormFillCaptureRequest) => ({
      ok: true as const,
      result: { capture: {} } as FormFillCaptureResponse,
    }));
    const scanner = new EasyApplyScanner(document, {
      id: ids(),
      settleMs: 60_000,
      captureBridge,
      bridge: async (request) => ({
        ok: true,
        result: response(request, [
          {
            ...unresolved("field-1"),
            question_id: "question-select",
            option_mappings: [
              { client_option_id: "field-1-option-1", question_option_id: "option-alpha" },
              { client_option_id: "field-1-option-2", question_option_id: "option-beta" },
            ],
          },
        ]),
      }),
    });
    scanner.setEnabled(true);
    await scanner.scan();
    const select = document.querySelector<HTMLSelectElement>("select")!;
    select.selectedIndex = 2;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(captureBridge).toHaveBeenCalledOnce());
    expect(captureBridge.mock.calls[0][0]).toMatchObject({
      question_id: "question-select",
      value: { kind: "single_choice", question_option_id: "option-beta" },
    });
    scanner.setEnabled(false);
  });

  it("holds numeric capture until validation-clean evidence", async () => {
    vi.useFakeTimers();
    fixture(`
      <div data-test-form-element>
        <label for="numeric-123456-numeric">Years</label>
        <input id="numeric-123456-numeric" type="text" inputmode="numeric"
          aria-describedby="numeric-123456-numeric-error">
        <div id="numeric-123456-numeric-error"></div>
      </div>`);
    const captureBridge = vi.fn(async (_request: FormFillCaptureRequest) => ({
      ok: true as const,
      result: { capture: {} } as FormFillCaptureResponse,
    }));
    const scanner = new EasyApplyScanner(document, {
      id: ids(),
      settleMs: 60_000,
      captureSettleMs: 20,
      captureBridge,
      bridge: async (request) => ({
        ok: true,
        result: response(request, [unresolved("field-1")]),
      }),
    });
    scanner.setEnabled(true);
    await scanner.scan();
    const input = document.querySelector<HTMLInputElement>("input")!;
    input.value = "4";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    await vi.advanceTimersByTimeAsync(20);
    expect(captureBridge).not.toHaveBeenCalled();

    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(captureBridge).toHaveBeenCalledOnce();
    expect(captureBridge.mock.calls[0][0]).toMatchObject({
      cleared: false,
      value: { kind: "decimal", value: "4" },
    });
    scanner.setEnabled(false);
  });

  it("accepts forward step progress as numeric capture proof", async () => {
    vi.useFakeTimers();
    history.replaceState({}, "", "/jobs/view/example-123456/");
    document.body.innerHTML = `
      <div class="jobs-easy-apply-modal">
        <h3>First step</h3><progress value="1" max="3"></progress>
        <div data-test-form-element>
          <label for="numeric-123456-numeric">Years</label>
          <input id="numeric-123456-numeric" type="text" inputmode="numeric"
            aria-describedby="numeric-123456-numeric-error">
          <div id="numeric-123456-numeric-error"></div>
        </div>
      </div>`;
    const captureBridge = vi.fn(async (_request: FormFillCaptureRequest) => ({
      ok: true as const,
      result: { capture: {} } as FormFillCaptureResponse,
    }));
    const scanner = new EasyApplyScanner(document, {
      id: ids(),
      settleMs: 60_000,
      captureSettleMs: 20,
      captureBridge,
      bridge: async (request) => ({
        ok: true,
        result: response(
          request,
          request.fields.map((item) => unresolved(item.client_field_id)),
        ),
      }),
    });
    scanner.setEnabled(true);
    await scanner.scan();
    const input = document.querySelector<HTMLInputElement>("input")!;
    input.value = "5";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    await vi.advanceTimersByTimeAsync(20);
    expect(captureBridge).not.toHaveBeenCalled();

    document.querySelector("h3")!.textContent = "Second step";
    document.querySelector<HTMLProgressElement>("progress")!.value = 2;
    await Promise.resolve();
    await scanner.scan();
    expect(captureBridge).toHaveBeenCalledOnce();
    expect(captureBridge.mock.calls[0][0].value).toEqual({ kind: "decimal", value: "5" });
    scanner.setEnabled(false);
  });

  it("marks a host validation error and never retries the fill", async () => {
    fixture(`
      <div data-test-form-element>
        <label for="numeric-123456-numeric">Years</label>
        <input id="numeric-123456-numeric" type="text" inputmode="numeric"
          aria-describedby="numeric-123456-numeric-error">
        <div id="numeric-123456-numeric-error"></div>
      </div>`);
    const input = document.querySelector<HTMLInputElement>("input")!;
    input.addEventListener("input", () => {
      document.getElementById("numeric-123456-numeric-error")!.textContent =
        "Enter a whole number between 0 and 3";
    });
    const setValue = vi.spyOn(HTMLInputElement.prototype, "value", "set");
    const scanner = new EasyApplyScanner(document, {
      id: ids(),
      settleMs: 60_000,
      bridge: async (request) => ({
        ok: true,
        result: response(request, [
          {
            status: "approved",
            client_field_id: "field-1",
            question_id: "question-numeric",
            answer_id: "answer-numeric",
            answer_revision: 1,
            mapping_id: "mapping-numeric",
            mapping_revision: 1,
            action: { kind: "set_decimal", value: "4" },
            option_mappings: [],
          },
        ]),
      }),
    });
    scanner.setEnabled(true);
    await scanner.scan();
    expect(input.value).toBe("4");
    expect(document.querySelector<HTMLElement>(".jh-ff-marker")?.dataset.state).toBe("failed");
    expect(setValue).toHaveBeenCalledTimes(1);
    await scanner.scan();
    expect(setValue).toHaveBeenCalledTimes(1);
    scanner.setEnabled(false);
  });

  it("re-resolves confirmation and fills only after the explicit Confirm action", async () => {
    fixture(field(1, "Confirm me"));
    const requests: FormFillResolutionRequest[] = [];
    const scanner = new EasyApplyScanner(document, {
      id: ids(),
      settleMs: 60_000,
      bridge: async (request) => {
        requests.push(request);
        const confirmed = request.fields[0].user_confirmed;
        return {
          ok: true,
          result: response(request, [
            confirmed
              ? {
                  status: "approved" as const,
                  client_field_id: "field-1",
                  question_id: "question-confirm",
                  answer_id: "answer-confirm",
                  answer_revision: 1,
                  mapping_id: "mapping-confirm",
                  mapping_revision: 1,
                  action: { kind: "set_text" as const, value: "confirmed-value" },
                  option_mappings: [],
                }
              : {
                  status: "confirmation_required" as const,
                  client_field_id: "field-1",
                  question_id: "question-confirm",
                  answer_id: "answer-confirm",
                  answer_revision: 1,
                  mapping_id: "mapping-confirm",
                  mapping_revision: 1,
                  option_mappings: [],
                },
          ]),
        };
      },
    });
    scanner.setEnabled(true);
    await scanner.scan();
    const input = document.querySelector<HTMLInputElement>("input")!;
    expect(input.value).toBe("");
    const panel = document.querySelector<HTMLElement>("[data-jh-ff-panel]")!.shadowRoot!;
    [...panel.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Confirm")!
      .click();
    await vi.waitFor(() => expect(input.value).toBe("confirmed-value"));
    expect(requests).toHaveLength(2);
    expect(requests[1].fields[0].user_confirmed).toBe(true);
    scanner.setEnabled(false);
  });

  it("undoes every still-owned fill without touching host action buttons", async () => {
    fixture(
      field(1, "First empty") + field(2, "Second empty"),
      '<button data-easy-apply-next-button>Next</button><button aria-label="Submit application">Submit</button>',
    );
    const hostAction = vi.fn();
    document
      .querySelectorAll<HTMLButtonElement>("footer button")
      .forEach((button) => button.addEventListener("click", hostAction));
    const scanner = new EasyApplyScanner(document, {
      id: ids(),
      settleMs: 60_000,
      bridge: async (request) => ({
        ok: true,
        result: response(
          request,
          request.fields.map((requestField, index) => ({
            status: "approved" as const,
            client_field_id: requestField.client_field_id,
            question_id: `question-${index + 1}`,
            answer_id: `answer-${index + 1}`,
            answer_revision: 1,
            mapping_id: `mapping-${index + 1}`,
            mapping_revision: 1,
            action: { kind: "set_text" as const, value: `filled-${index + 1}` },
            option_mappings: [],
          })),
        ),
      }),
    });
    scanner.setEnabled(true);
    await scanner.scan();
    expect(
      [...document.querySelectorAll<HTMLInputElement>("input")].map((input) => input.value),
    ).toEqual(["filled-1", "filled-2"]);
    const panel = document.querySelector<HTMLElement>("[data-jh-ff-panel]")!.shadowRoot!;
    [...panel.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Undo all fills")!
      .click();
    expect(
      [...document.querySelectorAll<HTMLInputElement>("input")].map((input) => input.value),
    ).toEqual(["", ""]);
    expect(hostAction).not.toHaveBeenCalled();
    scanner.setEnabled(false);
  });

  it("leaves every field untouched while resolution is offline", async () => {
    fixture(field(1, "Offline blank") + field(2, "Offline existing", "host-value"));
    const setValue = vi.spyOn(HTMLInputElement.prototype, "value", "set");
    const scanner = new EasyApplyScanner(document, {
      id: ids(),
      settleMs: 60_000,
      bridge: async () => ({ ok: false }),
    });
    scanner.setEnabled(true);
    await scanner.scan();
    expect(
      [...document.querySelectorAll<HTMLInputElement>("input")].map((input) => input.value),
    ).toEqual(["", "host-value"]);
    expect(setValue).not.toHaveBeenCalled();
    expect(
      [...document.querySelectorAll<HTMLElement>(".jh-ff-marker")].map(
        (marker) => marker.dataset.state,
      ),
    ).toEqual(["error", "error"]);
    scanner.setEnabled(false);
  });

  it("removes every form-fill surface immediately when disabled", async () => {
    fixture(field(1, "Question"));
    const scanner = new EasyApplyScanner(document, {
      id: ids(),
      settleMs: 60_000,
      bridge: async (request) => ({ ok: true, result: response(request, [unresolved("field-1")]) }),
    });
    scanner.setEnabled(true);
    await scanner.scan();
    expect(document.querySelector("[data-jh-ff-panel]")).not.toBeNull();
    scanner.setEnabled(false);
    expect(document.querySelector("[data-jh-ff-panel]")).toBeNull();
    expect(document.querySelector(".jh-ff-marker")).toBeNull();
  });
});
