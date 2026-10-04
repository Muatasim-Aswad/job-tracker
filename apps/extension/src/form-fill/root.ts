import { FORM_CONTROL } from "./accessibility.js";

export type SearchTree = Document | ShadowRoot;

const DIALOG = 'dialog[open], [role="dialog"], [aria-modal="true"]';
const LAUNCHER = 'button, a, [role="button"]';
const EASY_APPLY_NAME = /easy[\s_-]?apply/i;
export const LAUNCH_WINDOW_MS = 5_000;

export function openShadowRoots(tree: SearchTree): ShadowRoot[] {
  const roots: ShadowRoot[] = [];
  for (const element of tree.querySelectorAll("*")) {
    if (!element.shadowRoot || element.hasAttribute("data-jh-ff-ui")) continue;
    roots.push(element.shadowRoot, ...openShadowRoots(element.shadowRoot));
  }
  return roots;
}

function openDialogs(tree: SearchTree): HTMLElement[] {
  return [tree, ...openShadowRoots(tree)].flatMap((searched) => [
    ...searched.querySelectorAll<HTMLElement>(DIALOG),
  ]);
}

function namesEasyApply(element: Element): boolean {
  return [...element.attributes].some(
    (attribute) => EASY_APPLY_NAME.test(attribute.name) || EASY_APPLY_NAME.test(attribute.value),
  );
}

export function hasEasyApplyMarker(dialog: Element): boolean {
  return namesEasyApply(dialog) || [...dialog.querySelectorAll("*")].some(namesEasyApply);
}

export function isEasyApplyLauncher(target: Element): boolean {
  const launcher = target.closest(LAUNCHER);
  return (
    !!launcher && (namesEasyApply(launcher) || EASY_APPLY_NAME.test(launcher.textContent ?? ""))
  );
}

export function isDialogMutation(mutation: MutationRecord): boolean {
  const target =
    mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
  if (target?.closest(DIALOG)) return true;
  return [...mutation.addedNodes, ...mutation.removedNodes].some(
    (node) => node instanceof Element && (node.matches(DIALOG) || !!node.querySelector(DIALOG)),
  );
}

interface Launch {
  at: number;
  existing: Set<HTMLElement>;
}

// The Easy Apply form is an open dialog with form controls that either names
// the feature in its markup or first appeared right after an Easy Apply
// launcher was activated. Nothing else is ever scanned.
export class EasyApplyRootFinder {
  private launch: Launch | null = null;
  private launched: HTMLElement | null = null;

  constructor(
    private readonly doc: Document,
    private readonly now: () => number = Date.now,
  ) {}

  noteActivation(target: Element): void {
    if (!isEasyApplyLauncher(target)) return;
    this.launch = { at: this.now(), existing: new Set(openDialogs(this.doc)) };
  }

  find(): HTMLElement | null {
    const dialogs = openDialogs(this.doc).filter((dialog) => !!dialog.querySelector(FORM_CONTROL));
    const marked = dialogs.find(hasEasyApplyMarker);
    if (marked) return marked;
    if (this.launched && dialogs.includes(this.launched)) return this.launched;
    this.launched = null;
    const launch = this.launch;
    if (!launch || this.now() - launch.at > LAUNCH_WINDOW_MS) return null;
    this.launched = dialogs.find((dialog) => !launch.existing.has(dialog)) ?? null;
    if (this.launched) this.launch = null;
    return this.launched;
  }

  reset(): void {
    this.launch = null;
    this.launched = null;
  }
}
