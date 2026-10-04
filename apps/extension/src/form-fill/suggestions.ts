import { visibleText } from "./accessibility.js";

const POPUP_REFERENCE = ["aria-controls", "aria-owns"] as const;
const OPTION = '[role="option"]';
export const SUGGESTION_WAIT_MS = 3_000;
const SUGGESTION_POLL_MS = 100;

export function isTypeahead(control: Element): boolean {
  return (
    control.getAttribute("role") === "combobox" ||
    control.getAttribute("aria-autocomplete") === "list"
  );
}

function popupIds(control: Element): string[] {
  return POPUP_REFERENCE.flatMap(
    (attribute) => control.getAttribute(attribute)?.split(/\s+/).filter(Boolean) ?? [],
  );
}

export function offersSuggestions(control: Element): boolean {
  return isTypeahead(control) && popupIds(control).length > 0;
}

function suggestionLists(control: Element): HTMLElement[] {
  const tree = control.getRootNode() as Document | ShadowRoot;
  return popupIds(control)
    .map((id) => tree.getElementById(id))
    .filter((list): list is HTMLElement => !!list);
}

export function isSuggestionTarget(control: Element, target: Element): boolean {
  return suggestionLists(control).some((list) => list.contains(target));
}

export function exactSuggestion(control: Element, value: string): HTMLElement | null {
  const wanted = value.replace(/\s+/g, " ").trim();
  if (!wanted) return null;
  for (const list of suggestionLists(control)) {
    const match = [...list.querySelectorAll<HTMLElement>(OPTION)].find(
      (option) => option.getAttribute("aria-disabled") !== "true" && visibleText(option) === wanted,
    );
    if (match) return match;
  }
  return null;
}

export async function waitForExactSuggestion(
  control: Element,
  value: string,
  timeoutMs = SUGGESTION_WAIT_MS,
): Promise<HTMLElement | null> {
  for (let waited = 0; ; waited += SUGGESTION_POLL_MS) {
    const match = exactSuggestion(control, value);
    if (match || waited >= timeoutMs) return match;
    await new Promise((resolve) => setTimeout(resolve, SUGGESTION_POLL_MS));
  }
}

// Hosts commit a suggestion from pointer or mouse handlers, so the full press
// sequence is dispatched on the option itself.
export function chooseSuggestion(option: HTMLElement): void {
  const view = option.ownerDocument.defaultView;
  const MouseEventConstructor = view?.MouseEvent ?? MouseEvent;
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    option.dispatchEvent(new MouseEventConstructor(type, { bubbles: true, cancelable: true }));
  }
}
