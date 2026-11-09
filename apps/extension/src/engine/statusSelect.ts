import { copy } from "./copy";
// The shared funnel supplies labels and valid forward moves. Corrections remain a
// dashboard-only action.
import type { Engine } from "./types.js";
import { JobFunnel } from "@job-tracker/shared/funnel";

export function createStatusSelect(engine: Engine) {
  // Host styles can override native select colors; inline important keeps both the
  // control and its options legible.
  function pinSelectTheme(select: HTMLSelectElement, resolved: boolean) {
    select.style.setProperty("color-scheme", "light", "important");
    select.style.setProperty("color", "#1d2226", "important");
    select.style.setProperty("background-color", resolved ? "#e6f7f0" : "#fff", "important");
  }

  function makeStatusSelect(jobId: string, card?: HTMLElement) {
    const select = document.createElement("select");
    select.className = "jh-btn jh-status";
    select.title = copy.statusSelect.applicationStatus;
    pinSelectTheme(select, JobFunnel.isResolved(engine.stateOf(jobId).status));
    select.addEventListener("click", (e) => e.stopPropagation());
    select.addEventListener("mousedown", (e) => e.stopPropagation());
    select.addEventListener("change", (e) => {
      e.stopPropagation();
      const value = select.value;
      // State may have advanced since the options were built.
      if (!JobFunnel.canSet(engine.stateOf(jobId).status, value)) {
        syncStatusSelect(select, engine.stateOf(jobId).status);
        return;
      }
      if (card) engine.captureCardFromAction(card); // real listing before the status event
      // Status never changes the independent hidden flag. Restore the selection if
      // the server rejects or cannot receive the write.
      void engine.emit(jobId, value).then((state) => {
        if (!state) syncStatusSelect(select, engine.stateOf(jobId).status);
      });
    });
    return select;
  }

  // Show current state as a disabled header followed by valid forward choices.
  function syncStatusSelect(select: HTMLSelectElement, status: string) {
    select.innerHTML = "";
    const cur = document.createElement("option");
    cur.value = "__current";
    cur.textContent = JobFunnel.labelOf(status);
    cur.disabled = true;
    select.appendChild(cur);
    for (const value of JobFunnel.settableChoices(status)) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = JobFunnel.labelOf(value);
      select.appendChild(opt);
    }
    select.value = "__current";
  }

  return { pinSelectTheme, makeStatusSelect, syncStatusSelect };
}
