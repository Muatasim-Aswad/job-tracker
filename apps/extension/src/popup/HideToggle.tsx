import { useEffect, useState } from "react";
import { ICON } from "../icons.js";
import { ACTION_BUTTON, ICON as ICON_CLASS } from "./ui";

// List-display control. Shows the current choice as an icon + word (contrast /
// Dimmed, eye-off / Removed) and flips it on click, with the affected card states
// spelled out in the tooltip. Backed by the `hideMode` storage key and the
// `modeChanged` content-script message.
type Mode = "dim" | "remove";

const FACE: Record<Mode, { icon: string; text: string; label: string; title: string }> = {
  dim: {
    icon: ICON.contrast,
    text: "Dimmed",
    label: "Triaged, hidden, and blocked listings: dimmed",
    title:
      "To-apply, post-application, closed-out, hidden, and blocked listings are greyed out but stay in discovery lists. Click to remove them instead.",
  },
  remove: {
    icon: ICON.eyeOff,
    text: "Removed",
    label: "Triaged, hidden, and blocked listings: removed",
    title:
      "To-apply, post-application, closed-out, hidden, and blocked listings are removed from discovery lists. Click to just grey them out instead.",
  },
};

export function HideToggle() {
  const [mode, setMode] = useState<Mode>("remove");

  useEffect(() => {
    chrome.storage.local.get("hideMode", (data) => {
      setMode((data.hideMode as Mode) || "remove");
    });
  }, []);

  const toggle = () => {
    const next: Mode = mode === "dim" ? "remove" : "dim";
    setMode(next);
    void chrome.storage.local.set({ hideMode: next });
    // Tell the active tab's content script to re-apply the new mode live.
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.id) void chrome.tabs.sendMessage(tab.id, { type: "modeChanged" });
    });
  };

  const f = FACE[mode];
  return (
    <button className={ACTION_BUTTON} title={f.title} aria-label={f.label} onClick={toggle}>
      <span className={ICON_CLASS} dangerouslySetInnerHTML={{ __html: f.icon }} />
      {f.text}
    </button>
  );
}
