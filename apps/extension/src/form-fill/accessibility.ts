export const FORM_CONTROL = 'input:not([type="hidden"]), textarea, select';
const REQUIRED_MARKER = /\s*\*\s*$/;

type LabelableControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export function visibleText(element: Element | null | undefined): string {
  return element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function isLabelable(element: Element): element is LabelableControl {
  return "labels" in element;
}

export function referencedText(element: Element, attribute: string): string {
  const ids = element.getAttribute(attribute)?.split(/\s+/).filter(Boolean) ?? [];
  const root = element.getRootNode() as Document | ShadowRoot;
  return ids
    .map((id) => visibleText(root.getElementById(id)))
    .filter(Boolean)
    .join(" ");
}

function ownLabelText(control: Element): string {
  if (!isLabelable(control)) return "";
  return [...(control.labels ?? [])].map(visibleText).find(Boolean) ?? "";
}

export function controlName(control: Element): string {
  return (
    ownLabelText(control) ||
    referencedText(control, "aria-labelledby") ||
    control.getAttribute("aria-label")?.trim() ||
    ""
  );
}

export function choiceGroup(input: HTMLInputElement): HTMLElement | null {
  return input.closest("fieldset") ?? input.closest<HTMLElement>('[role="radiogroup"]');
}

function comparablePrompt(value: string): string {
  return withoutMarker(value).toLocaleLowerCase();
}

// Radios may carry the question as their own aria-label. The visible prompt
// beside the group is preferred only when it states that same question, so an
// unrelated neighbouring text can never become the prompt.
export function choiceGroupName(group: HTMLElement, radios: HTMLInputElement[]): string {
  const labelled = referencedText(group, "aria-labelledby") || group.getAttribute("aria-label");
  if (labelled?.trim()) return labelled.trim();
  const shared = new Set(radios.map((radio) => radio.getAttribute("aria-label")?.trim() ?? ""));
  if (shared.size !== 1) return "";
  const [name] = shared;
  if (!name) return "";
  const visible = visibleText(group.previousElementSibling);
  return comparablePrompt(visible) === comparablePrompt(name) ? visible : name;
}

// A radio's option text is its label, or the text of the wrapper that holds
// this radio alone when its label is empty.
export function choiceOptionName(input: HTMLInputElement): string {
  const own = ownLabelText(input);
  if (own) return own;
  const group = choiceGroup(input);
  let option: HTMLElement = input;
  while (
    option.parentElement &&
    option.parentElement !== group &&
    option.parentElement.querySelectorAll('input[type="radio"]').length === 1
  ) {
    option = option.parentElement;
  }
  return option === input ? "" : visibleText(option);
}

function holdsOnly(element: HTMLElement, owned: Element[]): boolean {
  return [...element.querySelectorAll(FORM_CONTROL)].every((control) => owned.includes(control));
}

// The smallest element that groups a control with its question text and holds
// no other question's controls.
export function semanticContainer(control: HTMLElement): HTMLElement | null {
  if (control instanceof HTMLInputElement && control.type === "radio") {
    const group = choiceGroup(control);
    if (!group) return control.parentElement;
    const parent = group.parentElement;
    const radios = [...group.querySelectorAll('input[type="radio"]')];
    return parent && holdsOnly(parent, radios) ? parent : group;
  }
  const label = isLabelable(control) ? control.labels?.[0] : null;
  let cursor: HTMLElement | null = label ?? null;
  while (cursor && !cursor.contains(control)) cursor = cursor.parentElement;
  return cursor && holdsOnly(cursor, [control]) ? cursor : control.parentElement;
}

export function markedRequired(prompt: string): boolean {
  return REQUIRED_MARKER.test(prompt);
}

export function withoutMarker(prompt: string): string {
  return prompt.replace(REQUIRED_MARKER, "");
}
