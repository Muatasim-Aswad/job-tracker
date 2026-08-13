import type { FieldState, PresentedField } from "./types.js";

const UI_ATTRIBUTE = "data-jh-ff-ui";
const PANEL_ATTRIBUTE = "data-jh-ff-panel";
const MARKER_ATTRIBUTE = "data-jh-ff-marker";

const SYMBOL: Record<FieldState, string> = {
  ready: "✓",
  remembered: "◷",
  confirmation: "?",
  attention: "!",
  unresolved: "○",
  ignored: "–",
  manual: "◇",
  error: "!",
};

function counts(fields: PresentedField[]) {
  return {
    ready: fields.filter((field) => field.state === "ready" || field.state === "remembered").length,
    attention: fields.filter((field) =>
      ["confirmation", "attention", "unresolved", "error"].includes(field.state),
    ).length,
    manual: fields.filter((field) => field.state === "manual" || field.state === "ignored").length,
  };
}

function panelStyles(): string {
  return `
    :host { all: initial; color-scheme: light dark; }
    details { box-sizing: border-box; margin: 12px 0; border: 1px solid #8c9bab; border-radius: 8px;
      background: Canvas; color: CanvasText; font: 13px/1.4 system-ui, sans-serif; }
    summary { cursor: pointer; padding: 10px 12px; font-weight: 650; list-style-position: inside; }
    summary:focus-visible, button:focus-visible { outline: 2px solid #0a66c2; outline-offset: 2px; }
    .summary { margin-left: 8px; color: GrayText; font-weight: 450; }
    .promise { margin: 0; padding: 0 12px 10px; color: GrayText; }
    ol { margin: 0; border-top: 1px solid #c7cdd3; padding: 8px 12px 10px 32px; }
    li { padding: 3px 0; }
    button { border: 0; padding: 1px 3px; background: transparent; color: inherit; font: inherit;
      text-align: left; cursor: pointer; }
    .symbol { display: inline-block; width: 18px; font-weight: 700; }
    .detail { color: GrayText; }
    @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
  `;
}

function panelAnchor(root: HTMLElement): Element {
  return root.querySelector("h3, h4") ?? root.firstElementChild ?? root;
}

function ensurePanel(root: HTMLElement): ShadowRoot {
  let host = root.querySelector<HTMLElement>(`[${PANEL_ATTRIBUTE}]`);
  if (!host) {
    host = root.ownerDocument.createElement("div");
    host.setAttribute(UI_ATTRIBUTE, "");
    host.setAttribute(PANEL_ATTRIBUTE, "");
    const anchor = panelAnchor(root);
    anchor.insertAdjacentElement("afterend", host);
  }
  return host.shadowRoot ?? host.attachShadow({ mode: "open" });
}

function marker(field: PresentedField): HTMLElement {
  let element = field.container.querySelector<HTMLElement>(`:scope > [${MARKER_ATTRIBUTE}]`);
  if (!element) {
    element = field.container.ownerDocument.createElement("span");
    element.setAttribute(UI_ATTRIBUTE, "");
    element.setAttribute(MARKER_ATTRIBUTE, "");
    element.className = "jh-ff-marker";
    element.tabIndex = 0;
    field.container.appendChild(element);
  }
  element.dataset.state = field.state;
  element.setAttribute("role", "note");
  element.setAttribute("aria-label", `Job Tracker: ${field.label}`);
  element.replaceChildren(
    Object.assign(field.container.ownerDocument.createElement("span"), {
      className: "jh-ff-marker__symbol",
      textContent: SYMBOL[field.state],
    }),
    Object.assign(field.container.ownerDocument.createElement("span"), {
      textContent: field.label,
    }),
  );
  return element;
}

export function renderPresentation(root: HTMLElement, fields: PresentedField[]): void {
  const liveIds = new Set(fields.map((field) => field.clientFieldId));
  for (const old of root.querySelectorAll<HTMLElement>(`[${MARKER_ATTRIBUTE}]`)) {
    if (!old.dataset.fieldId || !liveIds.has(old.dataset.fieldId)) old.remove();
  }
  for (const field of fields) marker(field).dataset.fieldId = field.clientFieldId;

  const shadow = ensurePanel(root);
  const summary = counts(fields);
  const details = root.ownerDocument.createElement("details");
  details.open = summary.attention > 0 || summary.manual > 0;
  const heading = root.ownerDocument.createElement("summary");
  heading.append("Job Tracker");
  const tally = root.ownerDocument.createElement("span");
  tally.className = "summary";
  tally.setAttribute("aria-live", "polite");
  tally.textContent = `${summary.ready} ready · ${summary.attention} needs attention · ${summary.manual} manual`;
  heading.append(tally);
  details.append(heading);
  const promise = root.ownerDocument.createElement("p");
  promise.className = "promise";
  promise.textContent = "Dry run only. Job Tracker never continues or submits this application.";
  details.append(promise);
  const list = root.ownerDocument.createElement("ol");
  const priority: Record<FieldState, number> = {
    confirmation: 0,
    attention: 0,
    error: 0,
    unresolved: 1,
    manual: 2,
    ignored: 2,
    remembered: 3,
    ready: 3,
  };
  const listedFields = fields
    .map((field, index) => ({ field, index }))
    .sort((a, b) => priority[a.field.state] - priority[b.field.state] || a.index - b.index)
    .map(({ field }) => field);
  for (const field of listedFields) {
    const item = root.ownerDocument.createElement("li");
    const button = root.ownerDocument.createElement("button");
    button.type = "button";
    button.addEventListener("click", () => {
      field.container.scrollIntoView({ block: "center", behavior: "auto" });
    });
    const symbol = root.ownerDocument.createElement("span");
    symbol.className = "symbol";
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = SYMBOL[field.state];
    button.append(symbol, `${field.prompt}: ${field.label}`);
    if (field.detail) {
      const detail = root.ownerDocument.createElement("span");
      detail.className = "detail";
      detail.textContent = ` — ${field.detail}`;
      button.append(detail);
    }
    item.append(button);
    list.append(item);
  }
  details.append(list);
  shadow.replaceChildren(
    Object.assign(root.ownerDocument.createElement("style"), { textContent: panelStyles() }),
    details,
  );
}

export function clearPresentation(doc: Document): void {
  doc.querySelectorAll(`[${UI_ATTRIBUTE}]`).forEach((element) => element.remove());
}

export function isPresentationMutation(mutation: MutationRecord): boolean {
  const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
  return (
    mutation.type === "childList" &&
    nodes.length > 0 &&
    nodes.every(
      (node) =>
        node instanceof Element &&
        (node.hasAttribute(UI_ATTRIBUTE) || !!node.closest(`[${UI_ATTRIBUTE}]`)),
    )
  );
}
