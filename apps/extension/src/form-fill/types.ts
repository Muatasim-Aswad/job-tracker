import type { components } from "@job-tracker/shared/api";

export type ResolutionField = components["schemas"]["ResolutionField"];
export type ResolutionRequest = components["schemas"]["ResolutionRequest"];
export type ResolutionResponse = components["schemas"]["ResolutionResponse"];
export type ResolutionResult = ResolutionResponse["results"][number];
export type FillAction = Extract<ResolutionResult, { status: "approved" | "captured" }>["action"];
export type CaptureRequest = components["schemas"]["CaptureCreate"];
export type CaptureResponse = components["schemas"]["CaptureCreateResponse"];

export type SupportedControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export interface SupportedOptionTarget {
  clientOptionId: string;
  element: HTMLOptionElement | HTMLInputElement;
}

export interface SupportedField {
  kind: "supported";
  container: HTMLElement;
  control: SupportedControl;
  handle: string;
  optionTargets: SupportedOptionTarget[];
  request: ResolutionField;
}

export interface ManualField {
  kind: "manual";
  container: HTMLElement;
  handle: string;
  prompt: string;
  reason: string;
}

export type DiscoveredField = SupportedField | ManualField;

export type FieldState =
  | "filled"
  | "already"
  | "remembered"
  | "confirmation"
  | "differs"
  | "attention"
  | "unresolved"
  | "ignored"
  | "manual"
  | "failed"
  | "error";

export interface PresentedAction {
  label: string;
  run: () => void;
  kind?: "primary" | "quiet";
}

export interface PresentedField {
  clientFieldId: string;
  container: HTMLElement;
  prompt: string;
  state: FieldState;
  label: string;
  detail?: string;
  actions?: PresentedAction[];
  dashboardUrl?: string;
}
