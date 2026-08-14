import { afterEach, describe, expect, it } from "vitest";
import { discoverLinkedInFields, fieldFingerprint, linkedInPlatformId } from "./linkedin";
import type { SupportedField } from "./types";

const textQuestion = (id: string, prompt: string, extra = "") => `
  <div data-test-form-element>
    <label for="${id}">${prompt}</label>
    <input id="${id}" type="text" ${extra}>
  </div>`;

function root(html: string): HTMLElement {
  document.body.innerHTML = `<div class="jobs-easy-apply-modal"><h3>Application questions</h3>${html}</div>`;
  return document.querySelector(".jobs-easy-apply-modal")!;
}

afterEach(() => {
  document.body.replaceChildren();
  history.replaceState({}, "", "/");
});

describe("LinkedIn Easy Apply discovery", () => {
  it("extracts supported fields in DOM order without sending current values", () => {
    history.replaceState({}, "", "/jobs/view/example-role-123456/");
    const form = root(`
      ${textQuestion(
        "single-line-text-form-component-formElement-urn-li-jobs-applyformcommon-easyApplyFormElement-123456-10-text",
        "Preferred name",
        'required autocomplete="given-name" value="synthetic-existing"',
      )}
      <div data-test-form-element>
        <label for="text-entity-list-form-component-formElement-urn-li-jobs-applyformcommon-easyApplyFormElement-123456-11-multipleChoice">Work preference</label>
        <select id="text-entity-list-form-component-formElement-urn-li-jobs-applyformcommon-easyApplyFormElement-123456-11-multipleChoice" required>
          <option value="Choose an option">Choose an option</option>
          <option value="alpha">Option Alpha</option>
          <option value="beta">Option Beta</option>
        </select>
      </div>
      <div data-test-form-element>
        <fieldset><legend>Authorized to work?</legend>
          <label><input id="urn:li:fsd_formElement:urn:li:jobs_applyformcommon_easyApply:(123456,12,multipleChoice)-0" type="radio" name="auth">Yes</label>
          <label><input id="urn:li:fsd_formElement:urn:li:jobs_applyformcommon_easyApply:(123456,12,multipleChoice)-1" type="radio" name="auth">No</label>
        </fieldset>
      </div>
      ${textQuestion(
        "single-line-text-form-component-formElement-urn-li-jobs-applyformcommon-easyApplyFormElement-123456-13-numeric",
        "Years of experience",
        'required inputmode="numeric"',
      )}
    `);

    const fields = discoverLinkedInFields(form);
    expect(fields.map((field) => field.kind)).toEqual([
      "supported",
      "supported",
      "supported",
      "supported",
    ]);
    const requests = fields.map((field) => (field as SupportedField).request);
    expect(requests.map((field) => field.control_kind)).toEqual([
      "text",
      "select",
      "radio",
      "integer",
    ]);
    expect(requests[0]).toMatchObject({
      prompt: "Preferred name",
      section: "Application questions",
      autocomplete_token: "given-name",
      required: true,
      has_value: true,
      stable_field_key: null,
    });
    expect(JSON.stringify(requests)).not.toContain("synthetic-existing");
    expect(requests[1].options?.map((option) => option.label)).toEqual([
      "Option Alpha",
      "Option Beta",
    ]);
    expect(requests[2].prompt).toBe("Authorized to work?");
    expect(requests[2].options?.map((option) => option.label)).toEqual(["Yes", "No"]);
    expect(linkedInPlatformId(document, fields)).toBe("123456");
  });

  it("derives iframe listing context from a request-local form handle", () => {
    history.replaceState({}, "", "/preload/?mode=application");
    const fields = discoverLinkedInFields(
      root(
        textQuestion(
          "single-line-text-form-component-formElement-urn-li-jobs-applyformcommon-easyApplyFormElement-987654-20-text",
          "Portfolio note",
        ),
      ),
    );
    expect(linkedInPlatformId(document, fields)).toBe("987654");
  });

  it("classifies unsafe and unproven shapes locally", () => {
    const form = root(`
      ${textQuestion(
        "single-typeahead-entity-form-component-formElement-urn-li-jobs-applyformcommon-easyApplyFormElement-123456-30-text",
        "Location",
        'role="combobox" aria-autocomplete="list"',
      )}
      <div data-test-form-element><fieldset><legend>Choose a schedule</legend>
        <label><input type="radio" name="schedule">Morning</label>
        <label><input type="radio" name="schedule">Evening</label>
      </fieldset></div>
      <div data-test-form-element><label><input id="follow-company-checkbox" type="checkbox">Follow company</label></div>
      <div class="jobs-easy-apply-repeatable-groupings__groupings"><h4>Education</h4></div>
      <div data-test-form-element><label><input type="file">Upload résumé</label></div>
      <label><input id="jobsDocumentCardToggle-ember123" type="radio">Selected résumé</label>
    `);
    const fields = discoverLinkedInFields(form);
    expect(fields).toHaveLength(4);
    expect(fields.every((field) => field.kind === "manual")).toBe(true);
    expect(fields.map((field) => (field.kind === "manual" ? field.reason : ""))).toEqual(
      expect.arrayContaining([
        "Choose a typeahead suggestion manually.",
        "Only Yes/No radio questions are supported.",
        "This LinkedIn option is left unchanged.",
        "Profile entries must be reviewed manually.",
      ]),
    );
    expect(
      fields.map((field) => (field.kind === "manual" ? field.prompt : field.request.prompt)),
    ).not.toEqual(expect.arrayContaining(["Upload résumé", "Selected résumé"]));
  });

  it("fingerprints semantic state without including a value", () => {
    const field = discoverLinkedInFields(
      root(
        textQuestion(
          "single-line-text-form-component-formElement-urn-li-jobs-applyformcommon-easyApplyFormElement-123456-40-text",
          "Short answer",
          'value="synthetic-value"',
        ),
      ),
    )[0] as SupportedField;
    expect(fieldFingerprint(field)).not.toContain("synthetic-value");
    expect(fieldFingerprint(field)).toContain('"hasValue":true');
  });

  it("keeps ambiguous numeric text inputs manual", () => {
    const [field] = discoverLinkedInFields(
      root(
        textQuestion(
          "single-line-text-form-component-formElement-urn-li-jobs-applyformcommon-easyApplyFormElement-123456-41-numeric",
          "Numeric answer",
        ),
      ),
    );
    expect(field).toMatchObject({
      kind: "manual",
      reason: "This numeric format could not be classified safely.",
    });
  });
});
