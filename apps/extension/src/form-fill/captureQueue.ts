import type { FormFillCaptureRequest } from "../messages.js";
import type { CaptureBridge } from "./bridge.js";
import {
  numericValueSafe,
  snapshotControl,
  validationEvidence,
  type ControlSnapshot,
} from "./controls.js";
import { fieldIdentityFingerprint, stepIdentity } from "./linkedin.js";
import type { ResolutionResult, SupportedField } from "./types.js";

interface CaptureRuntime {
  field: SupportedField;
  identity: string;
  result: ResolutionResult;
  platformId: string;
}

export interface PendingCapture {
  handle: string;
  identity: string;
  snapshot: ControlSnapshot;
  source: FormFillCaptureRequest["source"];
  captureKey: string;
  signature: string;
  stepKey: string;
  numeric: boolean;
  numericProven: boolean;
  attempted: boolean;
}

interface CaptureHost {
  runtimeFor(handle: string): CaptureRuntime | undefined;
  enabled(): boolean;
  epoch(): number;
  waitingForValidation(handle: string, snapshot: ControlSnapshot): void;
  incompleteChoice(handle: string, snapshot: ControlSnapshot): void;
  settled(
    handle: string,
    pending: PendingCapture,
    questionId: string,
    cleared: boolean,
    ok: boolean,
  ): void;
}

interface CaptureQueueOptions {
  bridge: CaptureBridge;
  id(): string;
  settleMs: number;
  applicationContextId: string;
}

function snapshotKey(snapshot: ControlSnapshot): string {
  return JSON.stringify(snapshot);
}

function captureValue(
  runtime: CaptureRuntime,
  pending: PendingCapture,
): Pick<FormFillCaptureRequest, "cleared" | "value"> | null {
  const { snapshot } = pending;
  if (snapshot.kind === "text") {
    if (snapshot.value.trim() === "") return { cleared: true, value: null };
    if (
      runtime.field.request.control_kind === "integer" ||
      runtime.field.request.control_kind === "decimal"
    ) {
      if (!numericValueSafe(snapshot.value, runtime.field.request.control_kind)) return null;
      return {
        cleared: false,
        value: { kind: "decimal", value: snapshot.value },
      };
    }
    return {
      cleared: false,
      value: {
        kind: runtime.field.request.control_kind === "textarea" ? "long_text" : "text",
        value: snapshot.value,
      },
    };
  }
  const clientOptionId =
    snapshot.kind === "radio"
      ? snapshot.clientOptionId
      : runtime.field.optionTargets.find(
          (target) =>
            target.element instanceof HTMLOptionElement &&
            target.element.index === snapshot.selectedIndex,
        )?.clientOptionId;
  if (!clientOptionId) return { cleared: true, value: null };
  const questionOptionId = runtime.result.option_mappings?.find(
    (mapping) => mapping.client_option_id === clientOptionId,
  )?.question_option_id;
  return questionOptionId
    ? {
        cleared: false,
        value: {
          kind: "single_choice",
          question_option_id: questionOptionId,
        },
      }
    : null;
}

export class CaptureQueue {
  private pending = new Map<string, PendingCapture>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private flights = new Map<string, ReturnType<CaptureBridge>>();
  private lastSignatures = new Map<string, string>();

  constructor(
    private readonly options: CaptureQueueOptions,
    private readonly host: CaptureHost,
  ) {}

  get(handle: string): Readonly<PendingCapture> | undefined {
    return this.pending.get(handle);
  }

  has(handle: string): boolean {
    return this.pending.has(handle);
  }

  hasSucceeded(handle: string): boolean {
    return this.lastSignatures.has(handle);
  }

  cancelPending(): void {
    // Issued saves stay in flights so re-enabled captures still wait for them.
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
  }

  resetServer(): void {
    this.lastSignatures.clear();
    this.flights.clear();
  }

  validate(field: SupportedField): void {
    const pending = this.pending.get(field.handle);
    if (!pending) return;
    if (pending.numeric && validationEvidence(field) === "clean") pending.numericProven = true;
    void this.flush(field.handle);
  }

  queue(
    root: HTMLElement,
    field: SupportedField,
    source: PendingCapture["source"],
    validationCheckpoint: boolean,
  ): void {
    const snapshot = snapshotControl(field);
    const identity = fieldIdentityFingerprint(field);
    const signature = `${identity}\u0000${source}\u0000${snapshotKey(snapshot)}`;
    if (signature === this.lastSignatures.get(field.handle) && !this.pending.has(field.handle))
      return;

    const numeric =
      field.request.control_kind === "integer" || field.request.control_kind === "decimal";
    const existing = this.pending.get(field.handle);
    const pending: PendingCapture =
      existing?.signature === signature
        ? existing
        : {
            handle: field.handle,
            identity,
            snapshot,
            source,
            captureKey: this.options.id(),
            signature,
            stepKey: stepIdentity(root),
            numeric,
            numericProven: false,
            attempted: false,
          };
    if (numeric && validationCheckpoint && validationEvidence(field) === "clean") {
      pending.numericProven = true;
    }
    if (numeric && !pending.numericProven && snapshot.kind === "text" && snapshot.value.trim()) {
      this.host.waitingForValidation(field.handle, snapshot);
    }
    this.pending.set(field.handle, pending);

    const oldTimer = this.timers.get(field.handle);
    if (oldTimer) clearTimeout(oldTimer);
    const immediate =
      snapshot.kind !== "text" || snapshot.value.trim() === "" || validationCheckpoint;
    if (immediate) {
      void this.flush(field.handle);
      return;
    }
    const timer = setTimeout(() => void this.flush(field.handle), this.options.settleMs);
    this.timers.set(field.handle, timer);
  }

  async flush(handle: string): Promise<void> {
    const pending = this.pending.get(handle);
    const runtime = this.host.runtimeFor(handle);
    if (!pending || pending.attempted || !runtime || runtime.identity !== pending.identity) return;
    if (
      pending.numeric &&
      !pending.numericProven &&
      pending.snapshot.kind === "text" &&
      pending.snapshot.value.trim()
    ) {
      return;
    }

    const value = captureValue(runtime, pending);
    if (!value) {
      this.host.incompleteChoice(handle, pending.snapshot);
      return;
    }

    const result = runtime.result;
    const mapping =
      result.status === "approved" || result.status === "confirmation_required" ? result : null;
    const request: FormFillCaptureRequest = {
      application_context_id: this.options.applicationContextId,
      capture_key: pending.captureKey,
      page: { platform: "linkedin", platform_id: runtime.platformId },
      question_id: result.question_id,
      source: pending.source,
      mapping_id: mapping?.mapping_id ?? null,
      mapping_revision_used: mapping?.mapping_revision ?? null,
      answer_revision_used: mapping?.answer_revision ?? null,
      ...value,
    };

    pending.attempted = true;
    // Serialize by server Question, including across DOM handles and disable/re-enable,
    // so an older save cannot arrive after a newer edit or clear.
    const previous = this.flights.get(result.question_id);
    const epoch = this.host.epoch();
    const flight = (async () => {
      if (previous) await previous;
      if (!this.host.enabled() || epoch !== this.host.epoch()) return { ok: false as const };
      try {
        return await this.options.bridge(request);
      } catch {
        return { ok: false as const };
      }
    })();
    this.flights.set(result.question_id, flight);
    const response = await flight;
    if (this.flights.get(result.question_id) === flight) {
      this.flights.delete(result.question_id);
    }

    // A completion owns only its own pending entry, never a later edit or timer.
    if (this.pending.get(handle) !== pending) return;
    this.pending.delete(handle);
    const timer = this.timers.get(handle);
    if (timer) clearTimeout(timer);
    this.timers.delete(handle);
    if (response.ok) this.lastSignatures.set(handle, pending.signature);
    else this.lastSignatures.delete(handle);
    this.host.settled(handle, pending, result.question_id, value.cleared, response.ok);
  }

  async flushOutgoing(previousStep: string, advanced: boolean): Promise<void> {
    const pending = [...this.pending.values()].filter(
      (item) => item.stepKey === previousStep && !item.attempted,
    );
    for (const item of pending) {
      if (item.numeric && advanced) item.numericProven = true;
      await this.flush(item.handle);
    }
  }
}
