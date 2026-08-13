import type { FillAction, SupportedField, SupportedOptionTarget } from "./types.js";

export type ControlSnapshot =
  | { kind: "text"; value: string }
  | { kind: "select"; value: string; selectedIndex: number }
  | { kind: "radio"; clientOptionId: string | null };

export interface OwnedWrite {
  before: ControlSnapshot;
  after: ControlSnapshot;
  fieldIdentity: string;
  source: "approved" | "captured";
}

function setNativeProperty(
  element: Element,
  property: "value" | "checked",
  value: string | boolean,
): boolean {
  let prototype: object | null = Object.getPrototypeOf(element);
  while (prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
    if (descriptor?.set) {
      descriptor.set.call(element, value);
      return true;
    }
    prototype = Object.getPrototypeOf(prototype);
  }
  return false;
}

function dispatch(control: HTMLElement, type: "input" | "change"): void {
  const EventConstructor = control.ownerDocument.defaultView?.Event ?? Event;
  control.dispatchEvent(new EventConstructor(type, { bubbles: true }));
}

function setNativeValue(
  control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  return setNativeProperty(control, "value", value);
}

function setNativeChecked(control: HTMLInputElement, checked: boolean) {
  return setNativeProperty(control, "checked", checked);
}

function checkedTarget(field: SupportedField): SupportedOptionTarget | undefined {
  return field.optionTargets.find(
    (target) => target.element instanceof HTMLInputElement && target.element.checked,
  );
}

export function snapshotControl(field: SupportedField): ControlSnapshot {
  const { control } = field;
  if (control instanceof HTMLSelectElement) {
    return { kind: "select", value: control.value, selectedIndex: control.selectedIndex };
  }
  if (control instanceof HTMLInputElement && control.type === "radio") {
    return { kind: "radio", clientOptionId: checkedTarget(field)?.clientOptionId ?? null };
  }
  return { kind: "text", value: control.value };
}

export function snapshotsEqual(left: ControlSnapshot, right: ControlSnapshot): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "text" && right.kind === "text") return left.value === right.value;
  if (left.kind === "select" && right.kind === "select") {
    return left.value === right.value && left.selectedIndex === right.selectedIndex;
  }
  return (
    left.kind === "radio" && right.kind === "radio" && left.clientOptionId === right.clientOptionId
  );
}

export function isControlEmpty(field: SupportedField): boolean {
  const snapshot = snapshotControl(field);
  if (snapshot.kind === "text") return snapshot.value.trim() === "";
  if (snapshot.kind === "radio") return snapshot.clientOptionId === null;
  return !field.optionTargets.some(
    (target) =>
      target.element instanceof HTMLOptionElement &&
      target.element.index === snapshot.selectedIndex,
  );
}

export function numericValueSafe(value: string, kind: "integer" | "decimal"): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) return false;
  return kind === "integer"
    ? /^[+-]?\d+$/.test(trimmed)
    : /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed);
}

function actionTarget(
  field: SupportedField,
  action: FillAction,
): SupportedOptionTarget | undefined {
  if (action.kind === "set_single_choice") {
    return field.optionTargets.find((target) => target.clientOptionId === action.client_option_id);
  }
  if (action.kind === "set_boolean") {
    const wanted = action.value ? "yes" : "no";
    return field.optionTargets.find((target) => {
      const label =
        target.element instanceof HTMLInputElement
          ? target.element.labels?.[0]?.textContent
          : target.element.textContent;
      return label?.trim().toLocaleLowerCase() === wanted;
    });
  }
  return undefined;
}

export function controlMatchesAction(field: SupportedField, action: FillAction): boolean {
  const snapshot = snapshotControl(field);
  if (action.kind === "set_text" || action.kind === "set_decimal") {
    return snapshot.kind === "text" && snapshot.value === action.value;
  }
  if (action.kind === "set_single_choice" || action.kind === "set_boolean") {
    const target = actionTarget(field, action);
    if (!target) return false;
    if (snapshot.kind === "select" && target.element instanceof HTMLOptionElement) {
      return (
        field.control instanceof HTMLSelectElement &&
        field.control.selectedIndex === target.element.index
      );
    }
    return snapshot.kind === "radio" && snapshot.clientOptionId === target.clientOptionId;
  }
  return false;
}

export function canApplyAction(field: SupportedField, action: FillAction): boolean {
  if (action.kind === "set_text") {
    return field.request.control_kind === "text" || field.request.control_kind === "textarea";
  }
  if (action.kind === "set_decimal") {
    return (
      (field.request.control_kind === "integer" || field.request.control_kind === "decimal") &&
      numericValueSafe(action.value, field.request.control_kind)
    );
  }
  if (action.kind === "set_single_choice" || action.kind === "set_boolean") {
    return (
      (field.request.control_kind === "select" || field.request.control_kind === "radio") &&
      !!actionTarget(field, action)
    );
  }
  return false;
}

export function applyAction(field: SupportedField, action: FillAction): boolean {
  if (!canApplyAction(field, action)) return false;
  const { control } = field;
  if (action.kind === "set_text" || action.kind === "set_decimal") {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement))
      return false;
    if (!setNativeValue(control, action.value)) return false;
    dispatch(control, "input");
    dispatch(control, "change");
    return controlMatchesAction(field, action);
  }

  const target = actionTarget(field, action);
  if (!target) return false;
  if (control instanceof HTMLSelectElement && target.element instanceof HTMLOptionElement) {
    if (!setNativeValue(control, target.element.value)) return false;
    dispatch(control, "input");
    dispatch(control, "change");
    return controlMatchesAction(field, action);
  }
  if (!(target.element instanceof HTMLInputElement)) return false;
  if (!setNativeChecked(target.element, true)) return false;
  dispatch(target.element, "input");
  dispatch(target.element, "change");
  return controlMatchesAction(field, action);
}

export function restoreSnapshot(field: SupportedField, snapshot: ControlSnapshot): boolean {
  const { control } = field;
  if (snapshot.kind === "text") {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement))
      return false;
    if (!setNativeValue(control, snapshot.value)) return false;
    dispatch(control, "input");
    dispatch(control, "change");
  } else if (snapshot.kind === "select") {
    if (!(control instanceof HTMLSelectElement) || !setNativeValue(control, snapshot.value))
      return false;
    dispatch(control, "input");
    dispatch(control, "change");
  } else {
    for (const target of field.optionTargets) {
      if (!(target.element instanceof HTMLInputElement)) continue;
      if (!setNativeChecked(target.element, target.clientOptionId === snapshot.clientOptionId))
        return false;
    }
    const target =
      field.optionTargets.find((option) => option.clientOptionId === snapshot.clientOptionId)
        ?.element ?? field.control;
    if (!(target instanceof HTMLElement)) return false;
    dispatch(target, "input");
    dispatch(target, "change");
  }
  return snapshotsEqual(snapshotControl(field), snapshot);
}

export type ValidationEvidence = "clean" | "error" | "unknown";

export function validationEvidence(field: SupportedField): ValidationEvidence {
  const { control, container } = field;
  const described = (control.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => control.ownerDocument.getElementById(id))
    .filter((element): element is HTMLElement => !!element);
  const errorNodes = [
    ...described.filter((element) => element.id.endsWith("-error")),
    ...container.querySelectorAll<HTMLElement>(
      ".artdeco-inline-feedback--error, .fb-dash-form-element__error-field",
    ),
  ];
  if (
    control.getAttribute("aria-invalid") === "true" ||
    errorNodes.some((element) => (element.textContent ?? "").trim().length > 0)
  ) {
    return "error";
  }
  if (!control.checkValidity()) return "error";
  if (control.getAttribute("aria-invalid") === "false" || errorNodes.length > 0) return "clean";
  return "unknown";
}
