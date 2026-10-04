import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyAction,
  controlMatchesAction,
  restoreSnapshot,
  snapshotControl,
  validationEvidence,
} from "./controls";
import { discoverLinkedInFields } from "./linkedin";
import type { SupportedField } from "./types";

function supported(html: string): SupportedField[] {
  document.body.innerHTML = `<div class="jobs-easy-apply-modal" role="dialog"><h3>Questions</h3>${html}</div>`;
  return discoverLinkedInFields(document.querySelector(".jobs-easy-apply-modal")!).filter(
    (field): field is SupportedField => field.kind === "supported",
  );
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("native Easy Apply controls", () => {
  it("sets and restores a select through its native value mechanism", () => {
    const [field] = supported(`
      <div data-test-form-element>
        <label for="select-formElement-1-multipleChoice">Preference</label>
        <select id="select-formElement-1-multipleChoice" required>
          <option value="Choose">Choose</option>
          <option value="alpha">Option Alpha</option>
          <option value="beta">Option Beta</option>
        </select>
      </div>`);
    const before = snapshotControl(field);
    const events: string[] = [];
    field.control.addEventListener("input", () => events.push("input"));
    field.control.addEventListener("change", () => events.push("change"));

    const action = { kind: "set_single_choice" as const, client_option_id: "field-1-option-2" };
    expect(applyAction(field, action)).toBe(true);
    expect((field.control as HTMLSelectElement).value).toBe("beta");
    expect(controlMatchesAction(field, action)).toBe(true);
    expect(events).toEqual(["input", "change"]);
    expect(restoreSnapshot(field, before)).toBe(true);
    expect((field.control as HTMLSelectElement).selectedIndex).toBe(0);
  });

  it("sets and restores a Yes/No radio group without clicking anything", () => {
    const [field] = supported(`
      <div data-test-form-element>
        <fieldset><legend>Authorized?</legend>
          <label><input id="radio-1-0" type="radio" name="auth">Yes</label>
          <label><input id="radio-1-1" type="radio" name="auth">No</label>
        </fieldset>
      </div>`);
    const before = snapshotControl(field);
    const click = vi.spyOn(HTMLElement.prototype, "click");
    const action = { kind: "set_boolean" as const, value: false };

    expect(applyAction(field, action)).toBe(true);
    expect((field.optionTargets[1].element as HTMLInputElement).checked).toBe(true);
    expect(controlMatchesAction(field, action)).toBe(true);
    expect(click).not.toHaveBeenCalled();
    expect(restoreSnapshot(field, before)).toBe(true);
    expect(
      field.optionTargets.every((target) => !(target.element as HTMLInputElement).checked),
    ).toBe(true);
  });

  it("sets a Yes/No answer on an SDUI radio group whose labels are empty", () => {
    document.body.innerHTML = `
      <dialog open><div data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.easyapply.EasyApply">
        <div componentkey="easyApplyFieldFocus_ea_validation_1">
          <p>Authorized?</p>
          <fieldset role="radiogroup">
            <div><div><input id="auth-0" aria-label="Authorized?" type="radio" name="auth"><label for="auth-0"></label></div><p>Yes</p></div>
            <div><div><input id="auth-1" aria-label="Authorized?" type="radio" name="auth"><label for="auth-1"></label></div><p>No</p></div>
          </fieldset>
        </div>
      </div></dialog>`;
    const [field] = discoverLinkedInFields(document.querySelector("dialog")!) as SupportedField[];

    expect(applyAction(field, { kind: "set_boolean", value: false })).toBe(true);
    expect((field.optionTargets[1].element as HTMLInputElement).checked).toBe(true);
  });

  it("sets an ordinary radio choice by its request-local option ID", () => {
    const [field] = supported(`
      <div data-test-form-element>
        <fieldset><legend>Preferred schedule</legend>
          <label><input id="schedule-0" type="radio" name="schedule">Morning</label>
          <label><input id="schedule-1" type="radio" name="schedule">Afternoon</label>
          <label><input id="schedule-2" type="radio" name="schedule">Evening</label>
        </fieldset>
      </div>`);
    const click = vi.spyOn(HTMLElement.prototype, "click");
    const action = {
      kind: "set_single_choice" as const,
      client_option_id: "field-1-option-3",
    };

    expect(applyAction(field, action)).toBe(true);
    expect((field.optionTargets[2].element as HTMLInputElement).checked).toBe(true);
    expect(controlMatchesAction(field, action)).toBe(true);
    expect(click).not.toHaveBeenCalled();
  });

  it("rejects decimals for LinkedIn numeric text inputs inferred as integers", () => {
    const [field] = supported(`
      <div data-test-form-element>
        <label for="numeric-formElement-1-numeric">Years</label>
        <input id="numeric-formElement-1-numeric" type="text" inputmode="text"
          aria-describedby="numeric-formElement-1-numeric-error">
        <div id="numeric-formElement-1-numeric-error"></div>
      </div>`);
    expect(field.request.control_kind).toBe("integer");
    expect(applyAction(field, { kind: "set_decimal", value: "1.5" })).toBe(false);
    expect((field.control as HTMLInputElement).value).toBe("");
    expect(validationEvidence(field)).toBe("clean");
    document.getElementById("numeric-formElement-1-numeric-error")!.textContent =
      "Enter a whole number";
    expect(validationEvidence(field)).toBe("error");
  });
});
