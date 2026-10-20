// Persistent page-wide reachability state, distinct from per-action error feedback.
import type { Engine } from "./types.js";
import { SERVER_URL } from "../config.js";

export function createOffline(engine: Engine) {
  let offline = false;

  function isOffline() {
    return offline;
  }

  function setOffline(v: boolean) {
    if (v === offline) return;
    offline = v;
    engine.renderAll();
  }

  // Called on every bar render so newly injected controls inherit current state.
  function decorateOffline(bar: HTMLElement) {
    bar.classList.toggle("jh-offline", offline);
    const existing = bar.querySelector(".jh-offline-badge");
    if (!offline) {
      existing?.remove();
      return;
    }
    if (existing) {
      existing.setAttribute(
        "title",
        `Job Tracker can't reach the server at ${SERVER_URL} — changes aren't being saved`,
      );
      return;
    }
    const badge = document.createElement("span");
    badge.className = "jh-offline-badge";
    badge.title = `Job Tracker can't reach the server at ${SERVER_URL} — changes aren't being saved`;
    badge.textContent = "⚠";
    bar.appendChild(badge);
  }

  return { isOffline, setOffline, decorateOffline };
}
