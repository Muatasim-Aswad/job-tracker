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
  document.body.innerHTML = `<div class="jobs-easy-apply-modal"><h3>Questions</h3>${html}</div>`;
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

  it("rejects unsafe numeric actions and observes host validation errors", () => {
    const [field] = supported(`
      <div data-test-form-element>
        <label for="numeric-formElement-1-numeric">Years</label>
        <input id="numeric-formElement-1-numeric" type="text" inputmode="numeric"
          aria-describedby="numeric-formElement-1-numeric-error">
        <div id="numeric-formElement-1-numeric-error"></div>
      </div>`);
    expect(applyAction(field, { kind: "set_decimal", value: "1.5" })).toBe(false);
    expect((field.control as HTMLInputElement).value).toBe("");
    expect(validationEvidence(field)).toBe("clean");
    document.getElementById("numeric-formElement-1-numeric-error")!.textContent =
      "Enter a whole number";
    expect(validationEvidence(field)).toBe("error");
  });
});
