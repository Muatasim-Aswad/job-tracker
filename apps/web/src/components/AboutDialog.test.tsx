import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AboutDialog } from "./AboutDialog";
import { runningBuild } from "../lib/buildInfo";

vi.mock("../lib/buildInfo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/buildInfo")>();
  return {
    ...actual,
    runningBuild: {
      version: "1.2.0",
      revision: "a".repeat(40),
      commit_time: "2026-10-13T09:00:00Z",
      build_time: "1980-01-01T00:00:00Z",
      dev: false,
    },
  };
});

beforeEach(() => {
  Object.assign(runningBuild, {
    version: "1.2.0",
    revision: "a".repeat(40),
    commit_time: "2026-10-13T09:00:00Z",
    build_time: "1980-01-01T00:00:00Z",
    dev: false,
  });
});

const current = {
  ...runningBuild,
  version: "9.9.9",
  revision: "e".repeat(40),
  dev: false,
  commit_time: "2026-10-13T09:00:00Z",
};
afterEach(cleanup);

describe("About dialog", () => {
  it("shows compiled identity separately from a different server build and offers explicit reload", () => {
    const reload = vi.fn();
    render(
      <AboutDialog
        onClose={vi.fn()}
        onCheck={vi.fn()}
        onReload={reload}
        result={{ status: "checked", current }}
      />,
    );
    expect(screen.getByText(/Track job opportunities/)).toBeTruthy();
    const running = within(screen.getByRole("region", { name: "Running build" }));
    expect(running.getByText(runningBuild.version)).toBeTruthy();
    expect(running.getByText(runningBuild.revision)).toBeTruthy();
    expect(running.getByText(runningBuild.build_time)).toBeTruthy();
    expect(running.getByText(runningBuild.commit_time ?? "Unverified")).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Server build" })).getByText("9.9.9"),
    ).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledOnce();
  });
  it.each([true, false])(
    "reports matching identity truthfully with dev=%s and no reload",
    (dev) => {
      if (dev) Object.assign(runningBuild, { dev: true, revision: "dev", commit_time: null });
      render(
        <AboutDialog
          onClose={vi.fn()}
          onCheck={vi.fn()}
          onReload={vi.fn()}
          result={{ status: "checked", current: runningBuild }}
        />,
      );
      expect(
        screen.getByText(dev ? /source changes may still differ/ : /running the current build/),
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
    },
  );
  it("keeps failed checks visible and retryable", () => {
    const check = vi.fn();
    const view = render(
      <AboutDialog
        onClose={vi.fn()}
        onCheck={check}
        onReload={vi.fn()}
        result={{ status: "failed" }}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("Couldn’t check");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(check).toHaveBeenCalledOnce();
    view.rerender(
      <AboutDialog
        onClose={vi.fn()}
        onCheck={check}
        onReload={vi.fn()}
        result={{ status: "checking" }}
      />,
    );
    expect(
      (screen.getByRole("button", { name: "Check again" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });
  it("traps focus, closes on Escape, and restores the opener", () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const close = vi.fn();
    const view = render(
      <AboutDialog
        onClose={close}
        onCheck={vi.fn()}
        onReload={vi.fn()}
        result={{ status: "failed" }}
      />,
    );
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Retry" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
