import type { FormFillCaptureRequest, FormFillResolutionRequest } from "../messages.js";
import { SERVER_URL } from "../config.js";
import {
  captureThroughWorker,
  resolveThroughWorker,
  type CaptureBridge,
  type ResolutionBridge,
} from "./bridge.js";
import {
  applyAction,
  canApplyAction,
  controlMatchesAction,
  isControlEmpty,
  numericValueSafe,
  restoreSnapshot,
  snapshotControl,
  snapshotsEqual,
  validationEvidence,
  type ControlSnapshot,
} from "./controls.js";
import {
  discoverLinkedInFields,
  EASY_APPLY_ROOT,
  fieldFingerprint,
  fieldIdentityFingerprint,
  linkedInPlatformId,
  stepIdentity,
} from "./linkedin.js";
import { clearPresentation, isPresentationMutation, renderPresentation } from "./presentation.js";
import {
  EASY_APPLY_ENABLED_KEY,
  EASY_APPLY_SUMMARY_OPEN_KEY,
  loadEasyApplyEnabled,
  loadEasyApplySummaryOpen,
  saveEasyApplySummaryOpen,
} from "./settings.js";
import type {
  FillAction,
  ManualField,
  PresentedField,
  ResolutionResult,
  SupportedField,
} from "./types.js";

const ADAPTER_ID = "linkedin.easy_apply";
const ADAPTER_VERSION = "1";
const SITE_SCOPE = "linkedin:easy-apply";
const SETTLE_MS = 180;
const CAPTURE_SETTLE_MS = 400;

function containsEasyApplyRoot(node: Node): boolean {
  return (
    node instanceof Element &&
    (node.matches(EASY_APPLY_ROOT) || !!node.querySelector(EASY_APPLY_ROOT))
  );
}

function mutationAffectsForm(doc: Document, mutation: MutationRecord): boolean {
  const root = doc.querySelector(EASY_APPLY_ROOT);
  if (root?.contains(mutation.target)) return true;
  return [...mutation.addedNodes, ...mutation.removedNodes].some(containsEasyApplyRoot);
}

function defaultId(): string {
  return crypto.randomUUID();
}

function progressValue(root: HTMLElement): number | null {
  const progress = root.querySelector<HTMLProgressElement>("progress");
  return progress && Number.isFinite(progress.value) ? progress.value : null;
}

function dashboardQuestionUrl(questionId: string): string {
  const url = new URL(SERVER_URL);
  url.searchParams.set("view", "form-fill");
  url.searchParams.set("section", "review");
  url.searchParams.set("type", "questions");
  url.searchParams.set("question", questionId);
  return url.toString();
}

function manualPresentation(field: ManualField, clientFieldId: string): PresentedField {
  return {
    clientFieldId,
    container: field.container,
    prompt: field.prompt,
    state: "manual",
    label: "Complete this manually",
    detail: field.reason,
  };
}

function snapshotKey(snapshot: ControlSnapshot): string {
  return JSON.stringify(snapshot);
}

function actionKey(action: FillAction): string {
  return JSON.stringify(action);
}

interface RuntimeField {
  field: SupportedField;
  identity: string;
  expected: ControlSnapshot;
  result: ResolutionResult;
  generation: number;
  root: HTMLElement;
  stepKey: string;
  platformId: string;
}

interface OwnershipRecord {
  control: SupportedField["control"];
  before: ControlSnapshot;
  after: ControlSnapshot;
  identity: string;
  action: FillAction;
  source: "approved" | "captured";
  stepKey: string;
}

interface FieldNote {
  state: "remembered" | "failed" | "already" | "attention";
  label: string;
  detail?: string;
  signature: string;
}

interface PendingCapture {
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

export interface ScannerOptions {
  bridge?: ResolutionBridge;
  captureBridge?: CaptureBridge;
  id?: () => string;
  isUserEvent?: (event: Event) => boolean;
  settleMs?: number;
  captureSettleMs?: number;
  saveSummaryOpen?: (open: boolean) => void;
}

export class EasyApplyScanner {
  private readonly bridge: ResolutionBridge;
  private readonly captureBridge: CaptureBridge;
  private readonly id: () => string;
  private readonly isUserEvent: (event: Event) => boolean;
  private readonly settleMs: number;
  private readonly captureSettleMs: number;
  private readonly saveSummaryOpen: (open: boolean) => void;
  private readonly applicationContextId: string;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private observer: MutationObserver | undefined;
  private enabled = false;
  private stepKey: string | null = null;
  private stepProgress: number | null = null;
  private baselineHandles = new Set<string>();
  private runtimeFields = new Map<string, RuntimeField>();
  private ownership = new Map<string, OwnershipRecord>();
  private pendingCaptures = new Map<string, PendingCapture>();
  private captureTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private conditionalIdentities = new Map<string, string>();
  private conditionalTimer: ReturnType<typeof setTimeout> | undefined;
  private lastCaptureSignatures = new Map<string, string>();
  private notes = new Map<string, FieldNote>();
  private suppressedWrites = new Set<string>();
  private writeDepth = 0;
  private renderedRoot: HTMLElement | null = null;
  private renderedFields: PresentedField[] = [];
  private summaryPreferenceKnown = false;
  private summaryOpen: boolean | undefined;

  constructor(
    private readonly doc: Document,
    options: ScannerOptions = {},
  ) {
    this.bridge = options.bridge ?? resolveThroughWorker;
    this.captureBridge = options.captureBridge ?? captureThroughWorker;
    this.id = options.id ?? defaultId;
    this.isUserEvent = options.isUserEvent ?? ((event) => event.isTrusted);
    this.settleMs = options.settleMs ?? SETTLE_MS;
    this.captureSettleMs = options.captureSettleMs ?? CAPTURE_SETTLE_MS;
    this.saveSummaryOpen = options.saveSummaryOpen ?? saveEasyApplySummaryOpen;
    this.applicationContextId = this.id();
  }

  setSummaryOpenPreference(open: boolean | undefined): void {
    this.summaryPreferenceKnown = true;
    if (open === this.summaryOpen) return;
    this.summaryOpen = open;
    this.renderCurrent();
  }

  initializeSummaryOpenPreference(open: boolean | undefined): void {
    if (this.summaryPreferenceKnown) return;
    this.setSummaryOpenPreference(open);
  }

  private rememberSummaryOpen(open: boolean): void {
    this.summaryPreferenceKnown = true;
    if (open === this.summaryOpen) return;
    this.summaryOpen = open;
    this.saveSummaryOpen(open);
    this.renderCurrent();
  }

  private readonly onControlEvent = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(EASY_APPLY_ROOT)) return;
    if (this.writeDepth > 0) return;

    const root = target.closest<HTMLElement>(EASY_APPLY_ROOT);
    if (!root) return;
    const field = discoverLinkedInFields(root).find(
      (item): item is SupportedField =>
        item.kind === "supported" && item.container.contains(target),
    );
    if (!field) return;

    const eventStep = stepIdentity(root);
    if (eventStep === this.stepKey && !this.baselineHandles.has(field.handle)) return;

    if (event.type === "focusout") {
      if (!this.isUserEvent(event)) return;
      const pending = this.pendingCaptures.get(field.handle);
      if (pending) {
        if (pending.numeric && validationEvidence(field) === "clean") {
          pending.numericProven = true;
        }
        void this.flushCapture(field.handle);
      }
      return;
    }

    const identity = fieldIdentityFingerprint(field);
    const current = snapshotControl(field);
    const owned = this.ownership.get(field.handle);
    if (
      owned &&
      owned.control === field.control &&
      owned.identity === identity &&
      snapshotsEqual(current, owned.after)
    ) {
      return;
    }
    if (owned && (!snapshotsEqual(current, owned.after) || owned.identity !== identity)) {
      this.ownership.delete(field.handle);
    }
    if (!this.isUserEvent(event)) {
      this.schedule();
      return;
    }
    const runtime = this.runtimeFields.get(field.handle);
    if (
      runtime &&
      runtime.identity === identity &&
      snapshotsEqual(current, runtime.expected) &&
      !this.pendingCaptures.has(field.handle) &&
      !this.lastCaptureSignatures.has(field.handle) &&
      this.notes.get(field.handle)?.state !== "failed"
    ) {
      return;
    }
    this.notes.delete(field.handle);
    for (const key of [...this.suppressedWrites]) {
      if (key.startsWith(`${field.handle}\u0000`)) this.suppressedWrites.delete(key);
    }

    this.queueCapture(field, "user_input", false);
    this.schedule();
  };

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.generation += 1;
      if (this.timer) clearTimeout(this.timer);
      for (const timer of this.captureTimers.values()) clearTimeout(timer);
      this.captureTimers.clear();
      if (this.conditionalTimer) clearTimeout(this.conditionalTimer);
      this.conditionalTimer = undefined;
      this.conditionalIdentities.clear();
      this.observer?.disconnect();
      this.observer = undefined;
      this.doc.removeEventListener("input", this.onControlEvent, true);
      this.doc.removeEventListener("change", this.onControlEvent, true);
      this.doc.removeEventListener("focusout", this.onControlEvent, true);
      clearPresentation(this.doc);
      this.stepKey = null;
      this.stepProgress = null;
      this.baselineHandles.clear();
      this.runtimeFields.clear();
      this.pendingCaptures.clear();
      this.renderedFields = [];
      this.renderedRoot = null;
      return;
    }
    this.observer = new MutationObserver((mutations) => {
      if (
        mutations.some(
          (mutation) =>
            !isPresentationMutation(mutation) && mutationAffectsForm(this.doc, mutation),
        )
      ) {
        this.schedule();
      }
    });
    this.observer.observe(this.doc.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-hidden", "aria-invalid", "aria-required", "disabled", "required"],
    });
    this.doc.addEventListener("input", this.onControlEvent, true);
    this.doc.addEventListener("change", this.onControlEvent, true);
    this.doc.addEventListener("focusout", this.onControlEvent, true);
    this.schedule();
  }

  schedule(): void {
    if (!this.enabled) return;
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    const expected = this.generation;
    this.timer = setTimeout(() => void this.scan(expected), this.settleMs);
  }

  private writeSuppressionKey(runtime: RuntimeField, snapshot: ControlSnapshot): string {
    const result = runtime.result;
    const action =
      result.status === "approved" || result.status === "captured" ? result.action : null;
    return `${runtime.field.handle}\u0000${runtime.stepKey}\u0000${runtime.identity}\u0000${snapshotKey(snapshot)}\u0000${action ? actionKey(action) : ""}`;
  }

  private liveField(runtime: RuntimeField): SupportedField | null {
    if (
      runtime.generation !== this.generation ||
      !this.enabled ||
      this.doc.querySelector(EASY_APPLY_ROOT) !== runtime.root ||
      stepIdentity(runtime.root) !== runtime.stepKey
    ) {
      return null;
    }
    const field = discoverLinkedInFields(runtime.root).find(
      (item): item is SupportedField =>
        item.kind === "supported" && item.handle === runtime.field.handle,
    );
    return field && fieldIdentityFingerprint(field) === runtime.identity ? field : null;
  }

  private basePresentation(runtime: RuntimeField) {
    return {
      clientFieldId: runtime.field.request.client_field_id,
      container: runtime.field.container,
      prompt: runtime.field.request.prompt,
      dashboardUrl: dashboardQuestionUrl(runtime.result.question_id),
    };
  }

  private updatePresentation(container: HTMLElement, field: PresentedField): void {
    const index = this.renderedFields.findIndex((item) => item.container === container);
    if (index >= 0) this.renderedFields[index] = field;
    else this.renderedFields.push(field);
    this.renderCurrent();
  }

  private renderCurrent(): void {
    if (!this.renderedRoot || !this.renderedRoot.isConnected) return;
    const hasOwnedWrites = [...this.ownership.entries()].some(([handle, owned]) => {
      const runtime = this.runtimeFields.get(handle);
      const live = runtime ? this.liveField(runtime) : null;
      return (
        !!live &&
        owned.control === live.control &&
        owned.identity === fieldIdentityFingerprint(live) &&
        snapshotsEqual(snapshotControl(live), owned.after)
      );
    });
    renderPresentation(this.renderedRoot, this.renderedFields, {
      undoAll: hasOwnedWrites ? () => this.undoAll() : undefined,
      open: this.summaryOpen,
      onOpenChange: (open) => this.rememberSummaryOpen(open),
    });
  }

  private presentationForAction(runtime: RuntimeField): PresentedField {
    const base = this.basePresentation(runtime);
    const result = runtime.result;
    if (result.status !== "approved" && result.status !== "captured") {
      return { ...base, state: "error", label: "Could not check this field" };
    }
    const live = this.liveField(runtime);
    if (!live) return { ...base, state: "error", label: "Field changed before filling" };
    runtime.field = live;
    const current = snapshotControl(live);
    const owned = this.ownership.get(live.handle);
    const note = this.notes.get(live.handle);
    if (
      owned &&
      owned.control === live.control &&
      owned.identity === runtime.identity &&
      snapshotsEqual(current, owned.after)
    ) {
      if (validationEvidence(live) === "error") {
        this.notes.set(live.handle, {
          state: "failed",
          label: "Filled value needs attention",
          detail: "The host reported a validation error. Job Tracker will not retry it.",
          signature: snapshotKey(current),
        });
        return {
          ...base,
          state: "failed",
          label: "Filled value needs attention",
          detail: "The host reported a validation error. Job Tracker will not retry it.",
          actions: [{ label: "Revert", run: () => this.revert(live.handle) }],
        };
      }
      return {
        ...base,
        state: owned.source === "captured" ? "remembered" : "filled",
        label:
          owned.source === "captured"
            ? "Filled from a remembered value"
            : "Filled from verified answer",
        actions: [{ label: "Revert", run: () => this.revert(live.handle) }],
      };
    }
    if (note && note.signature === snapshotKey(current)) {
      return {
        ...base,
        state: note.state,
        label: note.label,
        detail: note.detail,
      };
    }
    if (controlMatchesAction(live, result.action)) {
      return {
        ...base,
        state: "already",
        label:
          result.status === "captured"
            ? "Already matches remembered value"
            : "Already matches your answer",
      };
    }
    const suppressed = this.writeSuppressionKey(runtime, current);
    if (this.suppressedWrites.has(suppressed)) {
      return { ...base, state: "already", label: "Existing value kept" };
    }
    if (isControlEmpty(live)) {
      return this.applyRuntime(runtime, false);
    }
    return {
      ...base,
      state: "differs",
      label: "Existing value differs",
      detail: "The current value was preserved.",
      actions: [
        {
          label: "Use my answer",
          kind: "primary",
          run: () => this.updatePresentation(live.container, this.applyRuntime(runtime, true)),
        },
        {
          label: "Keep existing",
          run: () => {
            this.suppressedWrites.add(this.writeSuppressionKey(runtime, snapshotControl(live)));
            this.updatePresentation(live.container, {
              ...base,
              state: "already",
              label: "Existing value kept",
            });
          },
        },
        {
          label: "Remember existing",
          run: () => this.rememberExisting(runtime),
        },
      ],
    };
  }

  private applyRuntime(runtime: RuntimeField, explicitReplacement: boolean): PresentedField {
    const base = this.basePresentation(runtime);
    const result = runtime.result;
    if (result.status !== "approved" && result.status !== "captured") {
      return { ...base, state: "failed", label: "No fill action is available" };
    }
    const live = this.liveField(runtime);
    if (!live || !snapshotsEqual(snapshotControl(live), runtime.expected)) {
      return {
        ...base,
        state: "failed",
        label: "Field changed before filling",
        detail: "The latest form value was preserved.",
      };
    }
    if (!explicitReplacement && !isControlEmpty(live)) {
      return {
        ...base,
        state: "differs",
        label: "Existing value differs",
        detail: "The current value was preserved.",
      };
    }
    if (!canApplyAction(live, result.action)) {
      return {
        ...base,
        state: "failed",
        label: "Fill instruction is incompatible",
        detail: "Complete this field manually.",
      };
    }

    const before = snapshotControl(live);
    this.writeDepth += 1;
    let applied = false;
    try {
      applied = applyAction(live, result.action);
    } finally {
      this.writeDepth -= 1;
    }
    const after = snapshotControl(live);
    if (!applied || !controlMatchesAction(live, result.action)) {
      this.suppressedWrites.add(this.writeSuppressionKey(runtime, snapshotControl(live)));
      return {
        ...base,
        state: "failed",
        label: "Could not verify the filled value",
        detail: "Job Tracker will not retry this field.",
      };
    }
    runtime.field = live;
    runtime.expected = after;
    this.ownership.set(live.handle, {
      control: live.control,
      before,
      after,
      identity: runtime.identity,
      action: result.action,
      source: result.status,
      stepKey: runtime.stepKey,
    });
    if (validationEvidence(live) === "error") {
      return {
        ...base,
        state: "failed",
        label: "Filled value needs attention",
        detail: "The host reported a validation error. Job Tracker will not retry it.",
        actions: [{ label: "Revert", run: () => this.revert(live.handle) }],
      };
    }
    return {
      ...base,
      state: result.status === "captured" ? "remembered" : "filled",
      label:
        result.status === "captured"
          ? "Filled from a remembered value"
          : "Filled from verified answer",
      actions: [{ label: "Revert", run: () => this.revert(live.handle) }],
    };
  }

  private resultPresentation(runtime: RuntimeField): PresentedField {
    const base = this.basePresentation(runtime);
    const result = runtime.result;
    if (result.status === "approved" || result.status === "captured") {
      return this.presentationForAction(runtime);
    }
    const live = this.liveField(runtime);
    const note = live ? this.notes.get(live.handle) : undefined;
    if (live && note && note.signature === snapshotKey(snapshotControl(live))) {
      return {
        ...base,
        state: note.state,
        label: note.label,
        detail: note.detail,
      };
    }
    const existing = live && !isControlEmpty(live);
    const remember = existing
      ? [
          {
            label: "Remember existing",
            run: () => this.rememberExisting(runtime),
          },
        ]
      : undefined;
    switch (result.status) {
      case "confirmation_required":
        return {
          ...base,
          state: "confirmation",
          label: "Confirm before filling",
          detail: existing ? "The current value was preserved." : undefined,
          actions: [
            {
              label: "Confirm",
              kind: "primary",
              run: () => void this.confirm(runtime),
            },
            ...(remember ?? []),
          ],
        };
      case "conflict":
        return {
          ...base,
          state: "attention",
          label: "Review remembered values",
        };
      case "blocked":
        return {
          ...base,
          state: "attention",
          label: "Not filled — review needed",
          detail: result.reason,
        };
      case "ignored":
        return {
          ...base,
          state: "ignored",
          label: "Ignored in Job Tracker",
          detail: result.reason,
        };
      case "unresolved":
        return {
          ...base,
          state: "unresolved",
          label: existing ? "Existing value preserved" : "Needs your answer",
          actions: remember,
        };
    }
  }

  private async confirm(runtime: RuntimeField): Promise<void> {
    const live = this.liveField(runtime);
    if (!live || !snapshotsEqual(snapshotControl(live), runtime.expected)) return;
    const generation = runtime.generation;
    const scanId = this.id();
    const request: FormFillResolutionRequest = {
      application_context_id: this.applicationContextId,
      scan_id: scanId,
      page: {
        platform: "linkedin",
        platform_id: runtime.platformId,
        site_scope: SITE_SCOPE,
        adapter_id: ADAPTER_ID,
        adapter_version: ADAPTER_VERSION,
      },
      fields: [{ ...live.request, user_confirmed: true }],
    };
    const response = await this.bridge(request);
    if (!response.ok || response.result.scan_id !== scanId || generation !== this.generation)
      return;
    const result = response.result.results.find(
      (item) => item.client_field_id === live.request.client_field_id,
    );
    if (!result || result.question_id !== runtime.result.question_id) return;
    const confirmed: RuntimeField = {
      ...runtime,
      field: live,
      identity: fieldIdentityFingerprint(live),
      expected: snapshotControl(live),
      result,
    };
    this.runtimeFields.set(live.handle, confirmed);
    this.updatePresentation(live.container, this.resultPresentation(confirmed));
  }

  private revert(handle: string, schedule = true): void {
    const runtime = this.runtimeFields.get(handle);
    const owned = this.ownership.get(handle);
    if (!runtime || !owned) return;
    const live = this.liveField(runtime);
    if (
      !live ||
      owned.control !== live.control ||
      owned.identity !== fieldIdentityFingerprint(live) ||
      !snapshotsEqual(snapshotControl(live), owned.after)
    ) {
      this.ownership.delete(handle);
      return;
    }
    this.writeDepth += 1;
    let restored = false;
    try {
      restored = restoreSnapshot(live, owned.before);
    } finally {
      this.writeDepth -= 1;
    }
    if (!restored) return;
    this.ownership.delete(handle);
    runtime.field = live;
    runtime.expected = snapshotControl(live);
    this.suppressedWrites.add(this.writeSuppressionKey(runtime, runtime.expected));
    this.notes.set(handle, {
      state: "already",
      label: "Job Tracker fill reverted",
      signature: snapshotKey(runtime.expected),
    });
    if (schedule) this.schedule();
  }

  private undoAll(): void {
    for (const handle of [...this.ownership.keys()]) this.revert(handle, false);
    this.schedule();
  }

  private rememberExisting(runtime: RuntimeField): void {
    const live = this.liveField(runtime);
    if (!live || isControlEmpty(live)) return;
    this.queueCapture(live, "confirmed_external", true);
    void this.flushCapture(live.handle);
    this.schedule();
  }

  private queueCapture(
    field: SupportedField,
    source: PendingCapture["source"],
    validationCheckpoint: boolean,
  ): void {
    const snapshot = snapshotControl(field);
    const identity = fieldIdentityFingerprint(field);
    const signature = `${identity}\u0000${source}\u0000${snapshotKey(snapshot)}`;
    if (signature === this.lastCaptureSignatures.get(field.handle)) return;
    const numeric =
      field.request.control_kind === "integer" || field.request.control_kind === "decimal";
    const existing = this.pendingCaptures.get(field.handle);
    const pending: PendingCapture =
      existing?.signature === signature
        ? existing
        : {
            handle: field.handle,
            identity,
            snapshot,
            source,
            captureKey: this.id(),
            signature,
            stepKey: stepIdentity(field.container.closest(EASY_APPLY_ROOT)!),
            numeric,
            numericProven: false,
            attempted: false,
          };
    if (numeric && validationCheckpoint && validationEvidence(field) === "clean") {
      pending.numericProven = true;
    }
    if (numeric && !pending.numericProven && snapshot.kind === "text" && snapshot.value.trim()) {
      this.notes.set(field.handle, {
        state: "attention",
        label: "Waiting for numeric validation",
        detail: "This value will be remembered only after validation succeeds.",
        signature: snapshotKey(snapshot),
      });
    }
    this.pendingCaptures.set(field.handle, pending);

    const oldTimer = this.captureTimers.get(field.handle);
    if (oldTimer) clearTimeout(oldTimer);
    const immediate =
      snapshot.kind !== "text" || snapshot.value.trim() === "" || validationCheckpoint;
    if (immediate) {
      void this.flushCapture(field.handle);
      return;
    }
    const timer = setTimeout(() => void this.flushCapture(field.handle), this.captureSettleMs);
    this.captureTimers.set(field.handle, timer);
  }

  private captureValue(
    runtime: RuntimeField,
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

  private async flushCapture(handle: string): Promise<void> {
    const pending = this.pendingCaptures.get(handle);
    const runtime = this.runtimeFields.get(handle);
    if (!pending || pending.attempted || !runtime || runtime.identity !== pending.identity) return;
    if (
      pending.numeric &&
      !pending.numericProven &&
      pending.snapshot.kind === "text" &&
      pending.snapshot.value.trim()
    ) {
      return;
    }
    const captureValue = this.captureValue(runtime, pending);
    if (!captureValue) {
      this.notes.set(handle, {
        state: "failed",
        label: "Could not remember this choice",
        detail: "Its current option identity is incomplete.",
        signature: snapshotKey(pending.snapshot),
      });
      this.renderCurrent();
      return;
    }
    const result = runtime.result;
    const mapping =
      result.status === "approved" || result.status === "confirmation_required" ? result : null;
    const request: FormFillCaptureRequest = {
      application_context_id: this.applicationContextId,
      capture_key: pending.captureKey,
      page: { platform: "linkedin", platform_id: runtime.platformId },
      question_id: result.question_id,
      source: pending.source,
      mapping_id: mapping?.mapping_id ?? null,
      mapping_revision_used: mapping?.mapping_revision ?? null,
      answer_revision_used: mapping?.answer_revision ?? null,
      ...captureValue,
    };
    pending.attempted = true;
    const response = await this.captureBridge(request);
    this.pendingCaptures.delete(handle);
    this.captureTimers.delete(handle);
    if (response.ok) this.lastCaptureSignatures.set(handle, pending.signature);
    else this.lastCaptureSignatures.delete(handle);
    const signature = snapshotKey(pending.snapshot);
    this.notes.set(
      handle,
      response.ok
        ? {
            state: "remembered",
            label: captureValue.cleared
              ? "Remembered value cleared"
              : "Remembered for this exact question",
            signature,
          }
        : {
            state: "failed",
            label: "Could not remember this value",
            detail: "Change this field again to retry.",
            signature,
          },
    );
    this.schedule();
  }

  private async flushOutgoingCaptures(previousStep: string, advanced: boolean): Promise<void> {
    const pending = [...this.pendingCaptures.values()].filter(
      (item) => item.stepKey === previousStep && !item.attempted,
    );
    for (const item of pending) {
      if (item.numeric && advanced) item.numericProven = true;
      await this.flushCapture(item.handle);
    }
  }

  private scheduleConditionalRescan(): void {
    if (this.conditionalTimer) return;
    this.conditionalTimer = setTimeout(() => {
      this.conditionalTimer = undefined;
      void this.scan();
    }, this.settleMs);
  }

  async scan(expectedGeneration?: number): Promise<void> {
    if (!this.enabled) return;
    const generation = expectedGeneration ?? ++this.generation;
    if (generation !== this.generation) return;
    const root = this.doc.querySelector<HTMLElement>(EASY_APPLY_ROOT);
    if (!root) {
      clearPresentation(this.doc);
      return;
    }

    const discovered = discoverLinkedInFields(root);
    const currentStep = stepIdentity(root);
    const currentProgress = progressValue(root);
    if (this.stepKey && currentStep !== this.stepKey) {
      const advanced =
        this.stepProgress !== null &&
        currentProgress !== null &&
        currentProgress > this.stepProgress;
      await this.flushOutgoingCaptures(this.stepKey, advanced);
    }
    const supported = discovered.filter(
      (field): field is SupportedField => field.kind === "supported",
    );
    const manual = discovered.filter((field): field is ManualField => field.kind === "manual");
    if (currentStep !== this.stepKey) {
      this.stepKey = currentStep;
      this.stepProgress = currentProgress;
      this.baselineHandles = new Set(supported.map((field) => field.handle));
      this.conditionalIdentities.clear();
      this.runtimeFields.clear();
    } else {
      const presentHandles = new Set(supported.map((field) => field.handle));
      let needsRescan = false;
      for (const field of supported.splice(0, supported.length)) {
        if (this.baselineHandles.has(field.handle)) supported.push(field);
        else {
          const identity = fieldIdentityFingerprint(field);
          if (this.conditionalIdentities.get(field.handle) === identity) {
            this.baselineHandles.add(field.handle);
            this.conditionalIdentities.delete(field.handle);
            supported.push(field);
          } else {
            this.conditionalIdentities.set(field.handle, identity);
            needsRescan = true;
            manual.push({
              kind: "manual",
              container: field.container,
              handle: field.handle,
              prompt: field.request.prompt,
              reason: "Waiting for this new question to finish rendering.",
            });
          }
        }
      }
      for (const handle of [...this.conditionalIdentities.keys()]) {
        if (!presentHandles.has(handle)) this.conditionalIdentities.delete(handle);
      }
      if (needsRescan) this.scheduleConditionalRescan();
    }

    for (const field of supported) {
      const owned = this.ownership.get(field.handle);
      if (
        owned &&
        owned.control === field.control &&
        owned.identity === fieldIdentityFingerprint(field) &&
        snapshotsEqual(snapshotControl(field), owned.after) &&
        validationEvidence(field) === "error"
      ) {
        this.notes.set(field.handle, {
          state: "failed",
          label: "Filled value needs attention",
          detail: "The host reported a validation error. Job Tracker will not retry it.",
          signature: snapshotKey(owned.after),
        });
      }
    }

    const platformId = linkedInPlatformId(this.doc, discovered);
    if (!platformId || supported.length === 0) {
      if (!platformId) {
        for (const field of supported.splice(0, supported.length)) {
          manual.push({
            kind: "manual",
            container: field.container,
            handle: field.handle,
            prompt: field.request.prompt,
            reason: "Job Tracker could not identify this job safely.",
          });
        }
      }
      this.renderedRoot = root;
      this.renderedFields = manual.map((field, index) =>
        manualPresentation(field, `manual-${index + 1}`),
      );
      this.renderCurrent();
      return;
    }

    const fingerprints = new Map(supported.map((field) => [field.handle, fieldFingerprint(field)]));
    const identities = new Map(
      supported.map((field) => [field.handle, fieldIdentityFingerprint(field)]),
    );
    const snapshots = new Map(supported.map((field) => [field.handle, snapshotControl(field)]));
    const scanId = this.id();
    const request: FormFillResolutionRequest = {
      application_context_id: this.applicationContextId,
      scan_id: scanId,
      page: {
        platform: "linkedin",
        platform_id: platformId,
        site_scope: SITE_SCOPE,
        adapter_id: ADAPTER_ID,
        adapter_version: ADAPTER_VERSION,
      },
      fields: supported.map((field) => field.request),
    };
    const response = await this.bridge(request);
    if (generation !== this.generation || !this.enabled) return;

    const liveRoot = this.doc.querySelector<HTMLElement>(EASY_APPLY_ROOT);
    if (!liveRoot || liveRoot !== root || stepIdentity(root) !== currentStep) return;
    const live = discoverLinkedInFields(root);
    const liveSupported = new Map(
      live
        .filter((field): field is SupportedField => field.kind === "supported")
        .map((field) => [field.handle, field]),
    );
    const settled = supported
      .map((field) => liveSupported.get(field.handle))
      .filter(
        (field): field is SupportedField =>
          !!field &&
          fieldFingerprint(field) === fingerprints.get(field.handle) &&
          fieldIdentityFingerprint(field) === identities.get(field.handle) &&
          snapshotsEqual(snapshotControl(field), snapshots.get(field.handle)!),
      );
    this.renderedRoot = root;
    if (!response.ok || response.result.scan_id !== scanId) {
      this.renderedFields = [
        ...settled.map((field) => ({
          clientFieldId: field.request.client_field_id,
          container: field.container,
          prompt: field.request.prompt,
          state: "error" as const,
          label: "Could not check this field",
          detail: "Existing values were left untouched.",
        })),
        ...manual.map((field, index) => manualPresentation(field, `manual-${index + 1}`)),
      ];
      this.renderCurrent();
      return;
    }

    const results = new Map(
      response.result.results.map((result) => [result.client_field_id, result]),
    );
    const presentations: PresentedField[] = [];
    for (const field of settled) {
      const result = results.get(field.request.client_field_id);
      if (!result) {
        presentations.push({
          clientFieldId: field.request.client_field_id,
          container: field.container,
          prompt: field.request.prompt,
          state: "error",
          label: "Could not check this field",
          detail: "Existing values were left untouched.",
        });
        continue;
      }
      const runtime: RuntimeField = {
        field,
        identity: fieldIdentityFingerprint(field),
        expected: snapshotControl(field),
        result,
        generation,
        root,
        stepKey: currentStep,
        platformId,
      };
      this.runtimeFields.set(field.handle, runtime);
      presentations.push(this.resultPresentation(runtime));
      void this.flushCapture(field.handle);
    }
    presentations.push(
      ...manual.map((field, index) => manualPresentation(field, `manual-${index + 1}`)),
    );
    presentations.sort((a, b) =>
      a.container.compareDocumentPosition(b.container) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
    this.renderedFields = presentations;
    this.renderCurrent();
  }
}

export function startEasyApplyFormFill(doc: Document = document): EasyApplyScanner {
  const scanner = new EasyApplyScanner(doc);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[EASY_APPLY_ENABLED_KEY]) {
      scanner.setEnabled(changes[EASY_APPLY_ENABLED_KEY].newValue !== false);
    }
    if (changes[EASY_APPLY_SUMMARY_OPEN_KEY]) {
      const value = changes[EASY_APPLY_SUMMARY_OPEN_KEY].newValue;
      scanner.setSummaryOpenPreference(typeof value === "boolean" ? value : undefined);
    }
  });
  loadEasyApplySummaryOpen((open) => {
    scanner.initializeSummaryOpenPreference(open);
    loadEasyApplyEnabled((enabled) => scanner.setEnabled(enabled));
  });
  return scanner;
}
