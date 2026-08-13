import type {
  DiscoveredField,
  ManualField,
  ResolutionField,
  SupportedField,
  SupportedOptionTarget,
} from "./types.js";

export const EASY_APPLY_ROOT = ".jobs-easy-apply-modal, [data-test-easy-apply-modal]";
const QUESTION = "[data-test-form-element]";
const REPEATABLE = ".jobs-easy-apply-repeatable-groupings__groupings";
const UTILITY_CHECKBOX =
  'input[type="checkbox"][name="jobDetailsEasyApplyTopChoiceCheckbox"], input[type="checkbox"]#follow-company-checkbox';
const RESUME = 'input[type="file"], input[type="radio"][id^="jobsDocumentCardToggle-ember"]';
const SENSITIVE =
  /\b(?:captcha|signature|payment|credit card|bank|password|authentication|consent|terms|privacy policy)\b/i;
const SENSITIVE_AUTOCOMPLETE = /^(?:cc-|current-password|new-password|one-time-code)/i;
const NUMERIC_HANDLE = /-numeric(?:-error)?$/i;
const FORM_ELEMENT_JOB = /easyApplyFormElement-(\d+)-/i;
const RADIO_JOB = /easyApply:\((\d+),/i;

function text(element: Element | null | undefined): string {
  return element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function associatedLabel(container: HTMLElement, control: HTMLElement): string {
  if (control instanceof HTMLInputElement && control.type === "radio") {
    return text(control.closest("fieldset")?.querySelector(":scope > legend"));
  }
  const labels = "labels" in control ? (control as HTMLInputElement).labels : null;
  return text(labels?.[0] ?? container.querySelector("label"));
}

function sectionFor(container: HTMLElement, root: HTMLElement): string | null {
  let cursor: Element | null = container.previousElementSibling;
  while (cursor && root.contains(cursor)) {
    if (cursor.matches("h2, h3, h4, [data-test-form-section-title]")) return text(cursor) || null;
    cursor = cursor.previousElementSibling;
  }
  return text(root.querySelector("h3, h4")) || null;
}

function helpFor(container: HTMLElement, control: HTMLElement, prompt: string): string | null {
  const ids = control.getAttribute("aria-describedby")?.split(/\s+/).filter(Boolean) ?? [];
  const parts = ids
    .map((id) => control.ownerDocument.getElementById(id))
    .filter((node): node is HTMLElement => !!node)
    .filter((node) => !node.matches('[id$="-error"], .artdeco-inline-feedback--error'))
    .map(text)
    .filter((value) => value && value !== prompt);
  if (parts.length) return parts.join(" ");
  const local = text(
    container.querySelector(
      ".fb-dash-form-element__description, [data-test-form-element-description]",
    ),
  );
  return local && local !== prompt ? local : null;
}

function fieldHandle(container: HTMLElement, control: HTMLElement, index: number): string {
  if (control.id) return control.id.replace(/-\d+$/, "");
  return container.getAttribute("data-test-form-element") || `question-${index}`;
}

export function isSelectPlaceholder(select: HTMLSelectElement, index: number): boolean {
  if (index !== 0) return false;
  const option = select.options[index];
  return Boolean(
    !!option &&
    (option.disabled || option.hidden || (select.required && option.value.trim() === text(option))),
  );
}

function hasValue(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): boolean {
  if (control instanceof HTMLInputElement && control.type === "radio") {
    const fieldset = control.closest("fieldset");
    return !!fieldset?.querySelector('input[type="radio"]:checked');
  }
  if (control instanceof HTMLSelectElement) {
    return control.selectedIndex >= 0 && !isSelectPlaceholder(control, control.selectedIndex);
  }
  return control.value.trim().length > 0;
}

function currentSemanticValue(
  control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
): string {
  if (control instanceof HTMLInputElement && control.type === "radio") {
    const checked = control
      .closest("fieldset")
      ?.querySelector<HTMLInputElement>('input[type="radio"]:checked');
    return checked ? text(checked.labels?.[0]) : "";
  }
  if (control instanceof HTMLSelectElement) {
    return control.selectedIndex >= 0 ? text(control.options[control.selectedIndex]) : "";
  }
  return control.value;
}

function privateFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function selectOptions(select: HTMLSelectElement, clientFieldId: string) {
  return [...select.options]
    .filter((_, index) => {
      return !isSelectPlaceholder(select, index);
    })
    .map((option, index) => ({
      client_option_id: `${clientFieldId}-option-${index + 1}`,
      label: text(option),
      stable_option_key: null,
      disabled: option.disabled,
    }))
    .filter((option) => option.label);
}

function selectTargets(select: HTMLSelectElement, clientFieldId: string): SupportedOptionTarget[] {
  return [...select.options]
    .filter((_, index) => !isSelectPlaceholder(select, index))
    .map((option, index) => ({
      clientOptionId: `${clientFieldId}-option-${index + 1}`,
      element: option,
    }));
}

function radioOptions(fieldset: HTMLFieldSetElement, clientFieldId: string) {
  return [...fieldset.querySelectorAll<HTMLInputElement>('input[type="radio"]')].map(
    (input, index) => ({
      input,
      option: {
        client_option_id: `${clientFieldId}-option-${index + 1}`,
        label: text(input.labels?.[0]),
        stable_option_key: null,
        disabled: input.disabled,
      },
    }),
  );
}

function manual(
  container: HTMLElement,
  handle: string,
  prompt: string,
  reason: string,
): ManualField {
  return { kind: "manual", container, handle, prompt: prompt || "Application step", reason };
}

function classifyQuestion(
  container: HTMLElement,
  index: number,
  clientFieldId: string,
): DiscoveredField {
  const controls = [
    ...container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "input, textarea, select",
    ),
  ].filter((control) => !control.disabled);
  const first = controls[0];
  const prompt =
    associatedLabel(container, first ?? container) || text(container.querySelector("legend"));
  const handle = fieldHandle(container, first ?? container, index);

  if (!first) return manual(container, handle, prompt, "This control shape is not supported.");
  if (!prompt) {
    return manual(container, handle, prompt, "Question text could not be identified safely.");
  }
  if (container.querySelector(REPEATABLE)) {
    return manual(container, handle, prompt, "Profile entries must be reviewed manually.");
  }
  if (first.matches(RESUME)) {
    return manual(container, handle, prompt, "Résumés and files stay under your control.");
  }
  if (first.matches(UTILITY_CHECKBOX)) {
    return manual(container, handle, prompt, "This LinkedIn option is left unchanged.");
  }
  if (
    first.getAttribute("role") === "combobox" ||
    first.getAttribute("aria-autocomplete") === "list"
  ) {
    return manual(container, handle, prompt, "Choose a typeahead suggestion manually.");
  }
  if (SENSITIVE.test(prompt) || SENSITIVE_AUTOCOMPLETE.test(first.autocomplete)) {
    return manual(container, handle, prompt, "This sensitive control is never filled.");
  }

  let controlKind: ResolutionField["control_kind"];
  let options: ResolutionField["options"];
  let control: SupportedField["control"] = first;
  let optionTargets: SupportedOptionTarget[] = [];

  if (first instanceof HTMLSelectElement) {
    controlKind = "select";
    options = selectOptions(first, clientFieldId);
    optionTargets = selectTargets(first, clientFieldId);
    if (options.length === 0) {
      return manual(container, handle, prompt, "No selectable options are available yet.");
    }
  } else if (first instanceof HTMLTextAreaElement) {
    controlKind = "textarea";
  } else if (first.type === "radio") {
    const fieldset = first.closest("fieldset");
    if (!fieldset) return manual(container, handle, prompt, "This radio group is unclassified.");
    const radio = radioOptions(fieldset, clientFieldId);
    const labels = radio.map(({ option }) => option.label.toLocaleLowerCase());
    if (radio.length !== 2 || !labels.includes("yes") || !labels.includes("no")) {
      return manual(container, handle, prompt, "Only Yes/No radio questions are supported.");
    }
    controlKind = "radio";
    options = radio.map(({ option }) => option);
    optionTargets = radio.map(({ input, option }) => ({
      clientOptionId: option.client_option_id,
      element: input,
    }));
    control = radio[0].input;
  } else if (
    first.type === "text" ||
    first.type === "email" ||
    first.type === "tel" ||
    first.type === "number"
  ) {
    if (first.type === "number" || NUMERIC_HANDLE.test(first.id)) {
      const validationText = text(
        first.ownerDocument.getElementById(`${first.id}-error`) ??
          container.querySelector(".artdeco-inline-feedback--error"),
      );
      if (
        first.inputMode === "decimal" ||
        first.step === "any" ||
        /\bdecimal\b/i.test(validationText)
      ) {
        controlKind = "decimal";
      } else if (
        first.type === "number" ||
        first.inputMode === "numeric" ||
        /\b(?:whole number|integer)\b/i.test(validationText)
      ) {
        controlKind = "integer";
      } else {
        return manual(
          container,
          handle,
          prompt,
          "This numeric format could not be classified safely.",
        );
      }
    } else {
      controlKind = "text";
    }
  } else {
    return manual(container, handle, prompt, "This control shape is not supported.");
  }

  const request: ResolutionField = {
    client_field_id: clientFieldId,
    prompt,
    section: sectionFor(container, container.closest(EASY_APPLY_ROOT) as HTMLElement),
    help: helpFor(container, control, prompt),
    control_kind: controlKind,
    autocomplete_token: control.autocomplete || null,
    required: control.required || control.getAttribute("aria-required") === "true",
    has_value: hasValue(control),
    max_length: "maxLength" in control && control.maxLength >= 0 ? control.maxLength : null,
    stable_field_key: null,
    options,
    user_confirmed: false,
  };
  return { kind: "supported", container, control, handle, optionTargets, request };
}

function compareDom(a: DiscoveredField, b: DiscoveredField): number {
  if (a.container === b.container) return 0;
  return a.container.compareDocumentPosition(b.container) & Node.DOCUMENT_POSITION_FOLLOWING
    ? -1
    : 1;
}

export function discoverLinkedInFields(root: HTMLElement): DiscoveredField[] {
  const found: DiscoveredField[] = [...root.querySelectorAll<HTMLElement>(QUESTION)].map(
    (container, index) => classifyQuestion(container, index, `field-${index + 1}`),
  );
  const owned = new Set(found.map((field) => field.container));
  const supplementary = root.querySelectorAll<HTMLElement>(
    `${REPEATABLE}, ${RESUME}, ${UTILITY_CHECKBOX}`,
  );
  for (const element of supplementary) {
    const container =
      element.closest<HTMLElement>(QUESTION) ??
      (element.matches(REPEATABLE) ? element : null) ??
      element.closest<HTMLElement>(".js-jobs-document-upload__container, label") ??
      element.parentElement ??
      element;
    if (owned.has(container)) continue;
    owned.add(container);
    const index = found.length;
    const prompt = text(container.querySelector("h3, h4, legend, label"));
    const reason = element.matches(REPEATABLE)
      ? "Profile entries must be reviewed manually."
      : element.matches(UTILITY_CHECKBOX)
        ? "This LinkedIn option is left unchanged."
        : "Résumés and files stay under your control.";
    found.push(manual(container, `manual-${index + 1}`, prompt, reason));
  }
  return found.sort(compareDom);
}

export function linkedInPlatformId(doc: Document, fields: DiscoveredField[]): string | null {
  const url = new URL(doc.URL);
  const fromPath = url.pathname.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d+)/)?.[1];
  if (fromPath) return fromPath;
  const fromQuery = url.searchParams.get("currentJobId");
  if (fromQuery && /^\d+$/.test(fromQuery)) return fromQuery;
  for (const field of fields) {
    const match = field.handle.match(FORM_ELEMENT_JOB) ?? field.handle.match(RADIO_JOB);
    if (match) return match[1];
  }
  return null;
}

export function fieldFingerprint(field: SupportedField): string {
  const { request, control } = field;
  return JSON.stringify({
    handle: field.handle,
    prompt: request.prompt,
    section: request.section,
    help: request.help,
    kind: request.control_kind,
    required: request.required,
    hasValue: hasValue(control),
    valueFingerprint: privateFingerprint(currentSemanticValue(control)),
    options: request.options?.map((option) => [option.label, option.disabled]),
  });
}

export function fieldIdentityFingerprint(field: SupportedField): string {
  const { request } = field;
  return JSON.stringify({
    handle: field.handle,
    prompt: request.prompt,
    section: request.section,
    help: request.help,
    kind: request.control_kind,
    autocomplete: request.autocomplete_token,
    required: request.required,
    options: request.options?.map((option) => [
      option.client_option_id,
      option.label,
      option.disabled,
    ]),
  });
}

export function stepIdentity(root: HTMLElement): string {
  const headings = [...root.querySelectorAll("h3, h4")].map(text).filter(Boolean).join(" | ");
  const progress = root.querySelector<HTMLProgressElement>("progress");
  const position = progress ? `${progress.value}/${progress.max}` : "no-progress";
  return `${position}:${headings || "easy-apply-step"}`;
}
