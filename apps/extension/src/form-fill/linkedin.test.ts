import { afterEach, describe, expect, it } from "vitest";
import {
  clearLinkedInFollowCompanyDefault,
  discoverLinkedInFields,
  fieldFingerprint,
  linkedInPlatformId,
  stepIdentity,
  stepProgress,
} from "./linkedin";
import type { SupportedField } from "./types";

const textQuestion = (id: string, prompt: string, extra = "") => `
  <div data-test-form-element>
    <label for="${id}">${prompt}</label>
    <input id="${id}" type="text" ${extra}>
  </div>`;

const selectQuestion = (id: string, prompt: string, optionCount: number) => `
  <div data-test-form-element>
    <label for="${id}">${prompt}</label>
    <select id="${id}" required>
      <option value="Choose an option">Choose an option</option>
      ${Array.from(
        { length: optionCount },
        (_, index) => `<option value="option-${index + 1}">Option ${index + 1}</option>`,
      ).join("")}
    </select>
  </div>`;

const sduiRadio = (key: string, group: string, prompt: string, options: string[]) => `
  <div componentkey="easyApplyFieldFocus_ea_validation_p2_0_${key}">
    <p>${prompt}</p>
    <fieldset aria-describedby="error-message-${group}" role="radiogroup">
      ${options
        .map(
          (option, index) => `
        <div><div><div>
          <input id="${group}-${index}" aria-label="${prompt.replace("*", "")}" type="radio" name="radio-group-${group}">
          <label for="${group}-${index}"></label>
        </div><div><p>${option}</p></div></div></div>`,
        )
        .join("")}
    </fieldset>
  </div>`;

function sduiStep(position: string, title: string, questions: string): string {
  return `
    <div data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.easyapply.EasyApply">
      <div data-display-contents="true"><div><div>
        <div><div id="progress-label">50 percent complete</div><div aria-labelledby="progress-label"></div><p>${position} pages</p></div>
        <div data-testid="lazy-column" data-component-type="LazyColumn">
          <div><p>${title}</p><div>${questions}</div></div>
        </div>
      </div></div></div>
    </div>`;
}

function sduiRoot(html: string): HTMLElement {
  document.body.innerHTML = `<dialog data-testid="dialog" open><header><h2>Apply to Example Co</h2></header><div data-testid="dialog-content">${html}</div></dialog>`;
  return document.querySelector("dialog")!;
}

function root(html: string): HTMLElement {
  document.body.innerHTML = `<div class="jobs-easy-apply-modal" role="dialog"><h3>Application questions</h3>${html}</div>`;
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

  it.each([
    ["/jobs/view/separate-role-765432/", "765432"],
    ["/jobs/search/?keywords=engineer&currentJobId=876543", "876543"],
    ["/jobs/search-results/?currentJobId=987654", "987654"],
  ])("derives generic preload-frame context from %s", (route, expected) => {
    history.replaceState({}, "", route);
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const frameDocument = iframe.contentDocument!;
    frameDocument.body.innerHTML = `
      <div class="jobs-easy-apply-modal" role="dialog"><h3>Application questions</h3>
        ${textQuestion("generic-question-handle", "Portfolio note")}
      </div>`;
    const frameRoot = frameDocument.querySelector<HTMLElement>(".jobs-easy-apply-modal")!;
    const fields = discoverLinkedInFields(frameRoot);

    expect(linkedInPlatformId(frameDocument, fields)).toBe(expected);
  });

  it("supports localized radios and excludes LinkedIn's presentational required marker", () => {
    const [field] = discoverLinkedInFields(
      root(`
        <div data-test-form-element>
          <fieldset>
            <legend>
              <span data-test-form-builder-radio-button-form-component__title>
                <span>Hebt u het volgende opleidingsniveau voltooid: Bachelorgraad?</span>
              </span>
              <span class="visually-hidden"
                data-test-form-builder-radio-button-form-component__required> Required </span>
            </legend>
            <div><input id="education-0" type="radio" name="education" aria-required="true"><label for="education-0">Ja</label></div>
            <div><input id="education-1" type="radio" name="education" aria-required="true"><label for="education-1">Nee</label></div>
          </fieldset>
        </div>`),
    );

    expect(field.kind).toBe("supported");
    expect((field as SupportedField).request).toMatchObject({
      control_kind: "radio",
      prompt: "Hebt u het volgende opleidingsniveau voltooid: Bachelorgraad?",
      required: true,
    });
    expect((field as SupportedField).request.options?.map((option) => option.label)).toEqual([
      "Ja",
      "Nee",
    ]);
  });

  it("supports ordinary non-boolean radio choices without changing meaningful prompt text", () => {
    const [field] = discoverLinkedInFields(
      root(`
        <div data-test-form-element>
          <fieldset><legend>Which schedule is required?</legend>
            <label><input type="radio" name="schedule">Morning</label>
            <label><input type="radio" name="schedule">Afternoon</label>
            <label><input type="radio" name="schedule">Evening</label>
          </fieldset>
        </div>`),
    );

    expect(field.kind).toBe("supported");
    expect((field as SupportedField).request.prompt).toBe("Which schedule is required?");
    expect((field as SupportedField).request.options?.map((option) => option.label)).toEqual([
      "Morning",
      "Afternoon",
      "Evening",
    ]);
  });

  it("supports LinkedIn's location GEO typeahead as text", () => {
    const id =
      "single-typeahead-entity-form-component-formElement-urn-li-jobs-applyformcommon-easyApplyFormElement-123456-29-location-GEO-LOCATION";
    const [field] = discoverLinkedInFields(
      root(`
        <div data-test-form-element>
          <div data-test-single-typeahead-entity-form-component>
            <label for="${id}">Location (city)</label>
            <input id="${id}" type="text" role="combobox" aria-autocomplete="list" required>
          </div>
        </div>`),
    );

    expect(field).toMatchObject({
      kind: "supported",
      request: {
        prompt: "Location (city)",
        control_kind: "text",
        required: true,
      },
    });
  });

  it("classifies unsafe and unproven shapes locally", () => {
    const form = root(`
      ${textQuestion(
        "single-typeahead-entity-form-component-formElement-urn-li-jobs-applyformcommon-easyApplyFormElement-123456-30-text",
        "Employer",
        'role="combobox" aria-autocomplete="list"',
      )}
      <div data-test-form-element><fieldset><legend>Choose a schedule</legend>
        <label><input type="radio" name="schedule">Morning</label>
        <label><input type="radio" name="different-schedule">Evening</label>
      </fieldset></div>
      <div data-test-form-element><label><input id="synthetic-follow-control" type="checkbox">Follow Example Co to stay up to date with their page.</label></div>
      <div data-test-form-element><label><input name="jobDetailsEasyApplyTopChoiceCheckbox" type="checkbox">Mark this job as a top choice</label></div>
      <div class="jobs-easy-apply-repeatable-groupings__groupings"><h4>Education</h4></div>
      <div data-test-form-element><label><input type="file">Upload résumé</label></div>
      <label><input id="jobsDocumentCardToggle-ember123" type="radio">Selected résumé</label>
    `);
    const fields = discoverLinkedInFields(form);
    expect(fields).toHaveLength(3);
    expect(fields.every((field) => field.kind === "manual")).toBe(true);
    expect(fields.map((field) => (field.kind === "manual" ? field.reason : ""))).toEqual(
      expect.arrayContaining([
        "Choose a typeahead suggestion manually.",
        "This radio group could not be identified safely.",
        "Profile entries must be reviewed manually.",
      ]),
    );
    expect(
      fields.map((field) => (field.kind === "manual" ? field.prompt : field.request.prompt)),
    ).not.toEqual(
      expect.arrayContaining([
        "Follow Example Co to stay up to date with their page.",
        "Mark this job as a top choice",
        "Upload résumé",
        "Selected résumé",
      ]),
    );
  });

  it("ignores LinkedIn utility checkboxes even without a question wrapper", () => {
    const fields = discoverLinkedInFields(
      root(`
        <label><input id="follow-company-checkbox" type="checkbox">Follow Example Co</label>
        <label><input name="jobDetailsEasyApplyTopChoiceCheckbox" type="checkbox">Mark this job as a top choice</label>
      `),
    );
    expect(fields).toEqual([]);
  });

  it("clears only LinkedIn's initial follow-company selection once", () => {
    const form = root(`
      <div data-test-form-element>
        <label><input id="synthetic-follow-control" type="checkbox" checked>Follow Example Co to stay up to date with their page.</label>
      </div>
      <label><input name="jobDetailsEasyApplyTopChoiceCheckbox" type="checkbox" checked>Mark this job as a top choice</label>
      <label><input id="ordinary-checkbox" type="checkbox" checked>Ordinary preference</label>
    `);
    const follow = form.querySelector<HTMLInputElement>("#synthetic-follow-control")!;
    const topChoice = form.querySelector<HTMLInputElement>(
      '[name="jobDetailsEasyApplyTopChoiceCheckbox"]',
    )!;
    const ordinary = form.querySelector<HTMLInputElement>("#ordinary-checkbox")!;
    const events: string[] = [];
    follow.addEventListener("input", () => events.push("input"));
    follow.addEventListener("change", () => events.push("change"));
    const handled = new WeakSet<HTMLInputElement>();

    expect(clearLinkedInFollowCompanyDefault(form, handled)).toBe(1);
    expect(follow.checked).toBe(false);
    expect(topChoice.checked).toBe(true);
    expect(ordinary.checked).toBe(true);
    expect(events).toEqual(["input", "change"]);

    follow.checked = true;
    expect(clearLinkedInFollowCompanyDefault(form, handled)).toBe(0);
    expect(follow.checked).toBe(true);
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

  it("treats LinkedIn numeric text inputs without a decimal signal as integers", () => {
    const id =
      "single-line-text-form-component-formElement-urn-li-jobs-applyformcommon-easyApplyFormElement-123456-41-numeric";
    const [field] = discoverLinkedInFields(
      root(`
        <div data-test-form-element>
          <label for="${id}">How many years of JavaScript experience do you have?</label>
          <input id="${id}" type="text" required inputmode="text"
            aria-describedby="${id}-error">
          <div id="${id}-error"></div>
        </div>`),
    );
    expect(field).toMatchObject({
      kind: "supported",
      request: { control_kind: "integer" },
    });
  });

  it("keeps an explicit decimal signal classified as decimal", () => {
    const [field] = discoverLinkedInFields(
      root(
        textQuestion(
          "single-line-text-form-component-formElement-urn-li-jobs-applyformcommon-easyApplyFormElement-123456-42-numeric",
          "Years of experience",
          'required inputmode="decimal"',
        ),
      ),
    );
    expect(field).toMatchObject({
      kind: "supported",
      request: { control_kind: "decimal" },
    });
  });

  it("sends a select that sits exactly on the request option bound", () => {
    const [field] = discoverLinkedInFields(
      root(
        selectQuestion(
          "text-entity-list-form-component-formElement-urn-li-jobs-applyformcommon-easyApplyFormElement-123456-50-multipleChoice",
          "Phone country code",
          512,
        ),
      ),
    );
    expect(field.kind).toBe("supported");
    expect((field as SupportedField).request.options).toHaveLength(512);
  });

  it("keeps an oversized select manual and leaves the rest of the step resolvable", () => {
    const fields = discoverLinkedInFields(
      root(`
        ${selectQuestion(
          "text-entity-list-form-component-formElement-urn-li-jobs-applyformcommon-easyApplyFormElement-123456-51-multipleChoice",
          "Phone country code",
          513,
        )}
        ${textQuestion(
          "single-line-text-form-component-formElement-urn-li-jobs-applyformcommon-easyApplyFormElement-123456-52-text",
          "Preferred name",
        )}
      `),
    );
    expect(fields).toHaveLength(2);
    expect(fields[0]).toMatchObject({
      kind: "manual",
      prompt: "Phone country code",
      reason: "This list has too many options to check.",
    });
    expect(fields[1].kind).toBe("supported");
    expect((fields[1] as SupportedField).request.prompt).toBe("Preferred name");
  });

  it("keeps a malformed radio local while resolving its sibling field", () => {
    const fields = discoverLinkedInFields(
      root(`
        <div data-test-form-element><fieldset><legend>Choose one</legend>
          <label><input type="radio" name="broken">Same</label>
          <label><input type="radio" name="broken">Same</label>
        </fieldset></div>
        ${textQuestion(
          "single-line-text-form-component-formElement-urn-li-jobs-applyformcommon-easyApplyFormElement-123456-53-text",
          "Preferred name",
        )}
      `),
    );

    expect(fields[0]).toMatchObject({
      kind: "manual",
      prompt: "Choose one",
      reason: "This radio group could not be identified safely.",
    });
    expect(fields[1].kind).toBe("supported");
    expect((fields[1] as SupportedField).request.prompt).toBe("Preferred name");
  });
});

describe("LinkedIn SDUI Easy Apply discovery", () => {
  it("finds label-bound questions without LinkedIn's legacy question wrappers", () => {
    history.replaceState({}, "", "/jobs/view/123456/");
    const form = sduiRoot(
      sduiStep(
        "1/4",
        "Contact info",
        `
        <div><div><p><span>Synthetic Person</span></p></div></div>
        <div>
          <label for="_r_e_"><div>Email address*</div></label>
          <div><select id="_r_e_" required>
            <option value="" disabled></option>
            <option value="person@example.test">person@example.test</option>
          </select></div>
        </div>
        <div>
          <div>
            <label for="_r_g_"><div>Phone country code*</div></label>
            <div><select id="_r_g_" required>
              <option value="" disabled></option>
              <option value="nl">Netherlands (+31)</option>
              <option value="be">Belgium (+32)</option>
            </select></div>
          </div>
          <div componentkey="easyApplyFieldFocus_ea.q::111::PHONE_MOBILE::phoneNumber.validation">
            <label for="_r_i_"><div>Mobile phone number*</div></label>
            <div><input required id="_r_i_" aria-describedby="_r_i_-info" type="tel"></div>
          </div>
        </div>`,
      ),
    );

    const fields = discoverLinkedInFields(form);
    const requests = fields.map((field) => (field as SupportedField).request);
    expect(fields.map((field) => field.kind)).toEqual(["supported", "supported", "supported"]);
    expect(requests.map((request) => [request.prompt, request.control_kind])).toEqual([
      ["Email address", "select"],
      ["Phone country code", "select"],
      ["Mobile phone number", "text"],
    ]);
    expect(
      requests.every((request) => request.required && request.section === "Contact info"),
    ).toBe(true);
    expect(requests[1].options?.map((option) => option.label)).toEqual([
      "Netherlands (+31)",
      "Belgium (+32)",
    ]);
    expect(fields[2].handle).toBe(
      "easyApplyFieldFocus_ea.q::111::PHONE_MOBILE::phoneNumber.validation",
    );
    expect(linkedInPlatformId(document, fields)).toBe("123456");
  });

  it("reads radio prompts and option text that sit outside their empty labels", () => {
    const form = sduiRoot(
      sduiStep(
        "3/4",
        "Additional questions",
        `
        ${sduiRadio("222", "_r_l_", "Do you like hybrid work?*", ["Ja", "Nee"])}
        <div componentkey="easyApplyFieldFocus_ea_validation_p2_0_333">
          <label for="_r_r_"><div>How fluent is your Dutch?*</div></label>
          <div><select id="_r_r_" required>
            <option value="" disabled>Select an option</option>
            <option value="None">None</option>
            <option value="Professional">Professional</option>
          </select></div>
        </div>`,
      ),
    );

    const fields = discoverLinkedInFields(form) as SupportedField[];
    expect(fields.map((field) => field.request.control_kind)).toEqual(["radio", "select"]);
    expect(fields[0].request).toMatchObject({
      prompt: "Do you like hybrid work?",
      required: true,
      section: "Additional questions",
    });
    expect(fields[0].request.options?.map((option) => option.label)).toEqual(["Ja", "Nee"]);
    expect(fields[1].request.options?.map((option) => option.label)).toEqual([
      "None",
      "Professional",
    ]);
  });

  it("ignores the résumé choice", () => {
    const form = sduiRoot(
      sduiStep(
        "2/4",
        "",
        `
        <div><div><p>CV*</p></div><div>
          <fieldset aria-describedby="error-message-_r_j_" role="radiogroup"><div>
            <div id="easyApplyUploadedResumeRef" componentkey="easyApplyUploadedResumeRef"></div>
            <div><input id="_r_k_" aria-label="synthetic-resume.pdf" type="radio" name="radio-group-_r_j_" checked></div>
          </div></fieldset>
        </div></div>
        <input type="file" hidden>`,
      ),
    );

    expect(discoverLinkedInFields(form)).toEqual([]);
  });

  it("identifies steps by their page position rather than question text", () => {
    const form = sduiRoot(
      sduiStep(
        "2/4",
        "Additional questions",
        `${sduiRadio("444", "_r_x_", "24/7 on call?", ["Yes", "No"])}`,
      ),
    );

    expect(stepProgress(form)).toEqual({ value: 2, max: 4 });
    expect(stepIdentity(form)).toBe("2/4:Additional questions");
  });

  it("reads questions from accessible names when LinkedIn adds no question markup", () => {
    const form = sduiRoot(`
      <div><div>
        <span id="years-label">Years of TypeScript experience</span>
        <input id="_r_y_" type="number" aria-labelledby="years-label">
      </div></div>
      <div><textarea aria-label="Cover note"></textarea></div>
      <fieldset><legend>Willing to relocate?</legend>
        <label><input type="radio" name="relocate">Yes</label>
        <label><input type="radio" name="relocate">No</label>
      </fieldset>`);

    const fields = discoverLinkedInFields(form) as SupportedField[];
    expect(fields.map((field) => [field.request.prompt, field.request.control_kind])).toEqual([
      ["Years of TypeScript experience", "integer"],
      ["Cover note", "textarea"],
      ["Willing to relocate?", "radio"],
    ]);
  });

  it("never takes a radio prompt from neighbouring text that names another question", () => {
    const form = sduiRoot(`
      <div>
        <p>Unrelated introduction</p>
        <fieldset role="radiogroup">
          <div><input id="a" aria-label="Do you hold a driving licence?" type="radio" name="g"><label for="a">Yes</label></div>
          <div><input id="b" aria-label="Do you hold a driving licence?" type="radio" name="g"><label for="b">No</label></div>
        </fieldset>
      </div>
      <div>
        <p>Unnamed choice</p>
        <fieldset role="radiogroup">
          <div><input id="c" type="radio" name="h"><label for="c">Yes</label></div>
          <div><input id="d" type="radio" name="h"><label for="d">No</label></div>
        </fieldset>
      </div>`);

    const fields = discoverLinkedInFields(form);
    expect(fields[0]).toMatchObject({
      kind: "supported",
      request: { prompt: "Do you hold a driving licence?", required: false },
    });
    expect(fields[1]).toMatchObject({
      kind: "manual",
      reason: "Question text could not be identified safely.",
    });
  });
});
