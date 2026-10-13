// Isolate reachability decoration using a stub renderAll hook.
import { describe, expect, it, vi } from "vitest";

import { createOffline } from "./offline";
import type { Engine } from "./types";
import { SERVER_URL } from "../config";

function makeEngine() {
  const renderAll = vi.fn();
  const engine = { renderAll } as unknown as Engine;
  const offline = createOffline(engine);
  Object.assign(engine, offline);
  return { engine, renderAll, offline };
}

function makeBar() {
  const bar = document.createElement("div");
  bar.className = "jh-actions";
  return bar;
}

describe("setOffline", () => {
  it("defaults to online", () => {
    const { offline } = makeEngine();
    expect(offline.isOffline()).toBe(false);
  });

  it("flips the flag and re-renders on a change", () => {
    const { offline, renderAll } = makeEngine();
    offline.setOffline(true);
    expect(offline.isOffline()).toBe(true);
    expect(renderAll).toHaveBeenCalledTimes(1);
  });

  it("is a no-op (no re-render) when the state doesn't change", () => {
    const { offline, renderAll } = makeEngine();
    offline.setOffline(false); // already online
    offline.setOffline(true);
    offline.setOffline(true); // repeat — guarded
    expect(renderAll).toHaveBeenCalledTimes(1);
  });
});

describe("decorateOffline", () => {
  it("adds the class + a ⚠ badge whose title names the configured server URL", () => {
    const { offline } = makeEngine();
    const bar = makeBar();
    offline.setOffline(true);
    offline.decorateOffline(bar);

    expect(bar.classList.contains("jh-offline")).toBe(true);
    const badge = bar.querySelector(".jh-offline-badge");
    expect(badge?.textContent).toBe("⚠");
    expect(badge?.getAttribute("title")).toContain(SERVER_URL);
  });

  it("adds the badge only once across repeated renders", () => {
    const { offline } = makeEngine();
    const bar = makeBar();
    offline.setOffline(true);
    offline.decorateOffline(bar);
    offline.decorateOffline(bar);
    expect(bar.querySelectorAll(".jh-offline-badge")).toHaveLength(1);
  });

  it("removes the class + badge when back online", () => {
    const { offline } = makeEngine();
    const bar = makeBar();
    offline.setOffline(true);
    offline.decorateOffline(bar);

    offline.setOffline(false);
    offline.decorateOffline(bar);
    expect(bar.classList.contains("jh-offline")).toBe(false);
    expect(bar.querySelector(".jh-offline-badge")).toBeNull();
  });
});
