import type { FormFillResolutionRequest } from "../messages.js";
import { resolveThroughWorker, type ResolutionBridge } from "./bridge.js";
import {
  discoverLinkedInFields,
  EASY_APPLY_ROOT,
  fieldFingerprint,
  linkedInPlatformId,
  stepIdentity,
} from "./linkedin.js";
import { clearPresentation, isPresentationMutation, renderPresentation } from "./presentation.js";
import { EASY_APPLY_ENABLED_KEY, loadEasyApplyEnabled } from "./settings.js";
import type { ManualField, PresentedField, ResolutionResult, SupportedField } from "./types.js";

const ADAPTER_ID = "linkedin.easy_apply";
const ADAPTER_VERSION = "1";
const SITE_SCOPE = "linkedin:easy-apply";
const SETTLE_MS = 180;

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

export interface ScannerOptions {
  bridge?: ResolutionBridge;
  id?: () => string;
  settleMs?: number;
}

function defaultId(): string {
  return crypto.randomUUID();
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

function resultPresentation(field: SupportedField, result?: ResolutionResult): PresentedField {
  const base = {
    clientFieldId: field.request.client_field_id,
    container: field.container,
    prompt: field.request.prompt,
  };
  if (!result) {
    return { ...base, state: "error", label: "Could not check this field", detail: "Try again." };
  }
  switch (result.status) {
    case "approved":
      return { ...base, state: "ready", label: "Verified answer available", detail: "Dry run" };
    case "captured":
      return {
        ...base,
        state: "remembered",
        label: "Remembered value available",
        detail: result.source === "unattributed_change" ? "Source uncertain · dry run" : "Dry run",
      };
    case "confirmation_required":
      return { ...base, state: "confirmation", label: "Confirm before filling" };
    case "conflict":
      return { ...base, state: "attention", label: "Review remembered values" };
    case "blocked":
      return {
        ...base,
        state: "attention",
        label: "Not filled — review needed",
        detail: result.reason,
      };
    case "ignored":
      return { ...base, state: "ignored", label: "Ignored in Job Tracker", detail: result.reason };
    case "unresolved":
      return { ...base, state: "unresolved", label: "Needs your answer" };
  }
}

export class EasyApplyScanner {
  private readonly bridge: ResolutionBridge;
  private readonly id: () => string;
  private readonly settleMs: number;
  private readonly applicationContextId: string;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private observer: MutationObserver | undefined;
  private enabled = false;
  private stepKey: string | null = null;
  private baselineHandles = new Set<string>();
  private readonly onControlChange = (event: Event) => {
    if (event.target instanceof Element && event.target.closest(EASY_APPLY_ROOT)) this.schedule();
  };

  constructor(
    private readonly doc: Document,
    options: ScannerOptions = {},
  ) {
    this.bridge = options.bridge ?? resolveThroughWorker;
    this.id = options.id ?? defaultId;
    this.settleMs = options.settleMs ?? SETTLE_MS;
    this.applicationContextId = this.id();
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.generation += 1;
      if (this.timer) clearTimeout(this.timer);
      this.observer?.disconnect();
      this.observer = undefined;
      this.doc.removeEventListener("input", this.onControlChange, true);
      this.doc.removeEventListener("change", this.onControlChange, true);
      clearPresentation(this.doc);
      this.stepKey = null;
      this.baselineHandles.clear();
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
      attributeFilter: ["aria-hidden", "aria-required", "disabled", "required"],
    });
    this.doc.addEventListener("input", this.onControlChange, true);
    this.doc.addEventListener("change", this.onControlChange, true);
    this.schedule();
  }

  schedule(): void {
    if (!this.enabled) return;
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    const expected = this.generation;
    this.timer = setTimeout(() => void this.scan(expected), this.settleMs);
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
    const supported = discovered.filter(
      (field): field is SupportedField => field.kind === "supported",
    );
    const manual = discovered.filter((field): field is ManualField => field.kind === "manual");
    if (currentStep !== this.stepKey) {
      this.stepKey = currentStep;
      this.baselineHandles = new Set(supported.map((field) => field.handle));
    } else {
      for (const field of supported.splice(0, supported.length)) {
        if (this.baselineHandles.has(field.handle)) supported.push(field);
        else {
          manual.push({
            kind: "manual",
            container: field.container,
            handle: field.handle,
            prompt: field.request.prompt,
            reason: "A conditional question appeared after this step loaded.",
          });
        }
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
      renderPresentation(
        root,
        manual.map((field, index) => manualPresentation(field, `manual-${index + 1}`)),
      );
      return;
    }

    const fingerprints = new Map(supported.map((field) => [field.handle, fieldFingerprint(field)]));
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
    const settled = supported.filter((field) => {
      const current = liveSupported.get(field.handle);
      return current && fieldFingerprint(current) === fingerprints.get(field.handle);
    });
    if (!response.ok || response.result.scan_id !== scanId) {
      renderPresentation(root, [
        ...settled.map((field) => resultPresentation(field)),
        ...manual.map((field, index) => manualPresentation(field, `manual-${index + 1}`)),
      ]);
      return;
    }
    const results = new Map(
      response.result.results.map((result) => [result.client_field_id, result]),
    );
    const presentations = [
      ...settled.map((field) =>
        resultPresentation(field, results.get(field.request.client_field_id)),
      ),
      ...manual.map((field, index) => manualPresentation(field, `manual-${index + 1}`)),
    ];
    presentations.sort((a, b) =>
      a.container.compareDocumentPosition(b.container) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
    renderPresentation(root, presentations);
  }
}

export function startEasyApplyFormFill(doc: Document = document): EasyApplyScanner {
  const scanner = new EasyApplyScanner(doc);
  loadEasyApplyEnabled((enabled) => scanner.setEnabled(enabled));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[EASY_APPLY_ENABLED_KEY]) return;
    scanner.setEnabled(changes[EASY_APPLY_ENABLED_KEY].newValue !== false);
  });
  return scanner;
}
