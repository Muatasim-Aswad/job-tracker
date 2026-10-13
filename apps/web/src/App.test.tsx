import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { stubStorage } from "./test/storage";
import { runningBuild } from "./lib/buildInfo";

vi.mock("./hooks", () => ({
  useJobs: () => ({ data: [], refetch: vi.fn() }),
  useJobEvents: () => ({ mutate: vi.fn() }),
  useBlockedCompanies: () => ({ data: [] }),
  useFormFillReviewPresence: () => ({ hasReview: false }),
}));
vi.mock("./components/Board", () => ({ Board: () => <div>Jobs board</div> }));
vi.mock("./form-fill/FormFillWorkspace", () => ({
  FormFillWorkspace: () => <div>Form Fill collection</div>,
}));
beforeEach(() => {
  stubStorage();
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => new Response(JSON.stringify(runningBuild))),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each(["jobs", "form-fill"])(
  "opens About only through the burger in %s, suppresses shortcuts, and restores burger focus",
  async (view) => {
    window.history.replaceState(null, "", `/?view=${view}`);
    render(<App />);
    expect(screen.queryByText("About")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "About Job Tracker" })).toBeNull();
    expect(
      within(screen.getByRole("navigation", { name: "Primary workspace" })).queryByText("About"),
    ).toBeNull();
    const burger = screen.getByRole("button", { name: "Navigation and settings" });
    burger.focus();
    fireEvent.click(burger);
    fireEvent.click(screen.getByRole("menuitem", { name: "About" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("dialog", { name: "About Job Tracker" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("status").textContent).not.toContain("Checking"));
    fireEvent.keyDown(window, { key: "?" });
    fireEvent.keyDown(window, { key: "n" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(burger);
    expect(window.location.search).not.toContain("about");
  },
);
