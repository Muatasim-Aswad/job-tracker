import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { toast } from "./lib/toast";
const mocks = vi.hoisted(() => ({ refetch: vi.fn() }));
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { stubStorage } from "./test/storage";
import { runningBuild } from "./lib/buildInfo";

vi.mock("./hooks", () => ({
  useJobs: () => ({ data: [], refetch: mocks.refetch }),
  useJobEvents: () => ({ mutate: vi.fn() }),
  useBlockedCompanies: () => ({ data: [] }),
  useFormFillReviewPresence: () => ({ hasReview: false }),
}));
vi.mock("./components/Board", () => ({ Board: () => <div>Jobs board</div> }));
vi.mock("./form-fill/FormFillWorkspace", () => ({
  FormFillWorkspace: () => <div>Form Fill collection</div>,
}));
beforeEach(() => {
  mocks.refetch.mockReset().mockResolvedValue({ isError: false });
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

it("restores listing availability from a URL and clears it with the other filters", async () => {
  localStorage.setItem("jt.listingAvailability", "unavailable");
  window.history.replaceState(null, "", "/?listing_availability=closed");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Filters applied" }));
  const select = screen.getByRole("combobox", { name: "Listing" });
  expect((select as HTMLSelectElement).value).toBe("closed");
  fireEvent.change(select, { target: { value: "unavailable" } });
  expect((select as HTMLSelectElement).value).toBe("unavailable");
  expect(window.location.search).toContain("listing_availability=unavailable");
  expect(localStorage.getItem("jt.listingAvailability")).toBe("unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(window.location.search).not.toContain("listing_availability");
  expect(localStorage.getItem("jt.listingAvailability")).toBe("all");
});

it.each([
  ["jobs", "menu"],
  ["form-fill", "menu"],
  ["jobs", "link"],
  ["form-fill", "link"],
])("opens Extension settings in %s via %s and suppresses app shortcuts", async (view, source) => {
  window.history.replaceState(
    null,
    "",
    `/?view=${view}${source === "link" ? "&settings=extension" : ""}`,
  );
  vi.mocked(fetch).mockImplementation(
    async (url) =>
      new Response(
        JSON.stringify(
          (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).includes(
            "/settings",
          )
            ? {
                revision: "one",
                settings: {
                  easy_apply_enabled: true,
                  hide_mode: "dim",
                  search_diagnostics: { scope: "never", expires_at: null },
                  description_highlights: [],
                  title_rules: [],
                },
              }
            : runningBuild,
        ),
      ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
  const burger = screen.getByRole("button", { name: "Navigation and settings" });
  if (source === "menu") {
    burger.focus();
    fireEvent.click(burger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Extension settings…" }));
  }
  await screen.findByRole("button", { name: "Save settings" });
  fireEvent.keyDown(window, { key: "?" });
  fireEvent.keyDown(window, { key: "n" });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.getByRole("dialog", { name: "Extension settings" })).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  if (source === "menu") expect(document.activeElement).toBe(burger);
  expect(window.location.search).not.toContain("settings=");
});

it("gives progress and completion feedback for a manual refresh", async () => {
  let finish!: () => void;
  mocks.refetch.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  const feedback = vi.spyOn(toast, "info");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Refresh data" }));
  const button = screen.getByRole("button", { name: "Refreshing data…" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(button.getAttribute("aria-busy")).toBe("true");
  fireEvent.click(button);
  expect(mocks.refetch).toHaveBeenCalledOnce();
  await act(async () => finish());
  await waitFor(() => expect(feedback).toHaveBeenCalledWith("Data refreshed."));
  expect((screen.getByRole("button", { name: "Refresh data" }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  feedback.mockRestore();
});
it("gives failure feedback for a refresh from the mobile menu", async () => {
  mocks.refetch.mockRejectedValue(new Error("private backend detail"));
  const feedback = vi.spyOn(toast, "error");
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "Navigation and settings" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Refresh data" }));
  await waitFor(() =>
    expect(feedback).toHaveBeenCalledWith(
      "Couldn’t refresh data. Check your connection and try again.",
    ),
  );
  feedback.mockRestore();
});
