import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormFillResolutionRequest, FormFillResolutionResponse } from "../messages";
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

describe("generation-based dry-run scanning", () => {
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
    expect(panel.textContent).toContain("0 ready · 2 needs attention · 0 manual");
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

  it("has no native writer and never invokes host navigation or document actions", async () => {
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
