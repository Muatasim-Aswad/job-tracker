import type { components } from "@job-tracker/shared/api";

export type ResolutionField = components["schemas"]["ResolutionField"];
export type ResolutionRequest = components["schemas"]["ResolutionRequest"];
export type ResolutionResponse = components["schemas"]["ResolutionResponse"];
export type ResolutionResult = ResolutionResponse["results"][number];

export type SupportedControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export interface SupportedField {
  kind: "supported";
  container: HTMLElement;
  control: SupportedControl;
  handle: string;
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
  | "ready"
  | "remembered"
  | "confirmation"
  | "attention"
  | "unresolved"
  | "ignored"
  | "manual"
  | "error";

export interface PresentedField {
  clientFieldId: string;
  container: HTMLElement;
  prompt: string;
  state: FieldState;
  label: string;
  detail?: string;
}
