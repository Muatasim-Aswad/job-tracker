import type {
  DiscoveredField,
  ManualField,
  ResolutionField,
  SupportedField,
  SupportedOptionTarget,
} from "./types.js";
import { linkedinJobId } from "../adapters/builtin/linkedin/identity.js";

export const EASY_APPLY_ROOT = ".jobs-easy-apply-modal, [data-test-easy-apply-modal]";
const QUESTION = "[data-test-form-element]";
const REPEATABLE = ".jobs-easy-apply-repeatable-groupings__groupings";
const TOP_CHOICE_CHECKBOX = 'input[type="checkbox"][name="jobDetailsEasyApplyTopChoiceCheckbox"]';
const FOLLOW_COMPANY_CHECKBOX = 'input[type="checkbox"]#follow-company-checkbox';
const IGNORED_LINKEDIN_CHECKBOX = `${TOP_CHOICE_CHECKBOX}, ${FOLLOW_COMPANY_CHECKBOX}`;
const FOLLOW_COMPANY_PROMPT = /\bfollow\b.*\bstay up to date\b.*\bpage\b/i;
const RESUME = 'input[type="file"], input[type="radio"][id^="jobsDocumentCardToggle-ember"]';
const SENSITIVE =
  /\b(?:captcha|signature|payment|credit card|bank|password|authentication|consent|terms|privacy policy)\b/i;
const SENSITIVE_AUTOCOMPLETE = /^(?:cc-|current-password|new-password|one-time-code)/i;
const NUMERIC_HANDLE = /-numeric(?:-error)?$/i;
const FORM_ELEMENT_JOB = /easyApplyFormElement-(\d+)-/i;
const RADIO_JOB = /easyApply:\((\d+),/i;
// The API rejects a field carrying more options than this (`ResolutionField.options`
// in apps/api/app/form_fill/schemas.py), and it rejects the whole request with it, so
// one oversized control would leave every other field on the step unchecked. Keep this
// value equal to that bound.
const MAX_OPTIONS = 512;

function text(element: Element | null | undefined): string {
  return element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function questionText(element: Element | null | undefined): string {
  if (!element) return "";
  const copy = element.cloneNode(true) as Element;
  copy
    .querySelectorAll("[data-test-form-builder-radio-button-form-component__required]")
    .forEach((marker) => marker.remove());
  return text(copy);
}

function associatedLabel(container: HTMLElement, control: HTMLElement): string {
  if (control instanceof HTMLInputElement && control.type === "radio") {
    return questionText(control.closest("fieldset")?.querySelector(":scope > legend"));
  }
  const labels = "labels" in control ? (control as HTMLInputElement).labels : null;
  return questionText(labels?.[0] ?? container.querySelector("label"));
}

function isFollowCompanyCheckbox(input: HTMLInputElement): boolean {
  if (input.matches(FOLLOW_COMPANY_CHECKBOX)) return true;
  const label = input.labels?.[0] ?? input.closest(QUESTION);
  return FOLLOW_COMPANY_PROMPT.test(questionText(label));
}

function setNativeChecked(input: HTMLInputElement, checked: boolean): boolean {
  let prototype: object | null = Object.getPrototypeOf(input);
  while (prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "checked");
    if (descriptor?.set) {
      descriptor.set.call(input, checked);
      return true;
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return false;
}

export function clearLinkedInFollowCompanyDefault(
  root: HTMLElement,
  handled: WeakSet<HTMLInputElement>,
): number {
  let cleared = 0;
  for (const input of root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
    if (input.disabled || handled.has(input) || !isFollowCompanyCheckbox(input)) continue;
    if (!input.checked) {
      handled.add(input);
      continue;
    }
    if (!setNativeChecked(input, false)) continue;
    handled.add(input);
    const EventConstructor = input.ownerDocument.defaultView?.Event ?? Event;
    input.dispatchEvent(new EventConstructor("input", { bubbles: true }));
    input.dispatchEvent(new EventConstructor("change", { bubbles: true }));
    cleared += 1;
  }
  return cleared;
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
    }))
    .filter((target) => text(target.element));
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
): DiscoveredField | null {
  const enabledControls = [
    ...container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "input, textarea, select",
    ),
  ].filter((control) => !control.disabled);
  const controls = enabledControls.filter((control) => !control.matches(RESUME));
  const first = controls[0];
  const prompt =
    associatedLabel(container, first ?? container) || text(container.querySelector("legend"));
  const handle = fieldHandle(container, first ?? container, index);

  if (!first && enabledControls.some((control) => control.matches(RESUME))) return null;
  if (!first) return manual(container, handle, prompt, "This control shape is not supported.");
  if (
    first instanceof HTMLInputElement &&
    first.type === "checkbox" &&
    (first.matches(IGNORED_LINKEDIN_CHECKBOX) || FOLLOW_COMPANY_PROMPT.test(prompt))
  ) {
    return null;
  }
  if (!prompt) {
    return manual(container, handle, prompt, "Question text could not be identified safely.");
  }
  if (container.querySelector(REPEATABLE)) {
    return manual(container, handle, prompt, "Profile entries must be reviewed manually.");
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
    if (options.length > MAX_OPTIONS) {
      return manual(container, handle, prompt, "This list has too many options to check.");
    }
  } else if (first instanceof HTMLTextAreaElement) {
    controlKind = "textarea";
  } else if (first.type === "radio") {
    const fieldset = first.closest("fieldset");
    if (!fieldset) return manual(container, handle, prompt, "This radio group is unclassified.");
    const radio = radioOptions(fieldset, clientFieldId);
    const groupName = first.name.trim();
    const labels = radio.map(({ option }) => option.label);
    const normalizedLabels = labels.map((label) => label.normalize("NFKC").toLocaleLowerCase());
    if (
      radio.length < 2 ||
      radio.length > MAX_OPTIONS ||
      !groupName ||
      radio.some(({ input }) => input.name !== groupName) ||
      labels.some((label) => !label) ||
      new Set(normalizedLabels).size !== normalizedLabels.length
    ) {
      return manual(container, handle, prompt, "This radio group could not be identified safely.");
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
      } else {
        controlKind = "integer";
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
  const found = [...root.querySelectorAll<HTMLElement>(QUESTION)]
    .map((container, index) => classifyQuestion(container, index, `field-${index + 1}`))
    .filter((field): field is DiscoveredField => field !== null);
  const owned = new Set(found.map((field) => field.container));
  const supplementary = root.querySelectorAll<HTMLElement>(REPEATABLE);
  for (const element of supplementary) {
    const container = element.closest<HTMLElement>(QUESTION) ?? element;
    if (owned.has(container)) continue;
    owned.add(container);
    const index = found.length;
    const prompt = text(container.querySelector("h3, h4, legend, label"));
    found.push(
      manual(
        container,
        `manual-${index + 1}`,
        prompt,
        "Profile entries must be reviewed manually.",
      ),
    );
  }
  return found.sort(compareDom);
}

export function linkedInPlatformId(doc: Document, fields: DiscoveredField[]): string | null {
  const fromUrl = (source: string): string | null => {
    const url = new URL(source);
    const fromPath = linkedinJobId(url.pathname);
    if (fromPath) return fromPath;
    const fromQuery = url.searchParams.get("currentJobId");
    return fromQuery && /^\d+$/.test(fromQuery) ? fromQuery : null;
  };

  const ownContext = fromUrl(doc.URL);
  if (ownContext) return ownContext;
  for (const field of fields) {
    const match = field.handle.match(FORM_ELEMENT_JOB) ?? field.handle.match(RADIO_JOB);
    if (match) return match[1];
  }

  // Some LinkedIn routes host Easy Apply in a same-origin preload frame whose
  // generic field handles carry no job id. The owning job remains in an ancestor
  // route, so use that route only after the form's own evidence is exhausted.
  let frame: Window | null = doc.defaultView;
  while (frame) {
    const parent: Window = frame.parent;
    if (parent === frame) break;
    try {
      const ancestorContext = fromUrl(parent.location.href);
      if (ancestorContext) return ancestorContext;
    } catch {
      // A cross-origin ancestor is not usable context and also blocks traversal.
      break;
    }
    frame = parent;
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
