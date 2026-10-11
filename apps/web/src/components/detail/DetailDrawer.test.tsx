// Dialog behavior, settled mutation feedback, and status presentation.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Attention, JobDetail } from "@job-tracker/shared/api";
import { dismissToast, getToasts } from "../../lib/toast";
import { DetailDrawer } from "./DetailDrawer";

vi.mock("../../api/client", () => ({
  api: {
    getJob: vi.fn(),
    deleteJob: vi.fn(),
    deleteListing: vi.fn(),
    updateJob: vi.fn(() => new Promise(() => {})),
    updateListing: vi.fn(() => new Promise(() => {})),
    correctStatus: vi.fn(() => new Promise(() => {})),
    revertStatus: vi.fn(() => new Promise(() => {})),
    metaVocabulary: vi.fn(() => Promise.resolve({ keys: [] })),
    noteTitles: vi.fn(() => Promise.resolve([])),
  },
}));

import { api } from "../../api/client";

const mockedApi = vi.mocked(api);

// A promise the test resolves by hand, so "did it close on click or on success?"
// is answerable: between `mutate` and `resolve` the write is in flight.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // An unobserved rejection would fail the run before react-query ever sees it.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

const TWO_DAYS_AGO = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();

function makeJob(over: Partial<JobDetail> = {}): JobDetail {
  return {
    id: "job-1",
    title: "Backend Engineer",
    title_key: "backend engineer",
    company: "Sample Company",
    company_key: "sample company",
    status: "in_process",
    hidden: false,
    starred: false,
    meta: {},
    created_at: TWO_DAYS_AGO,
    updated_at: TWO_DAYS_AGO,
    listings: [
      {
        id: "l1",
        job_id: "job-1",
        platform: "linkedin",
        platform_id: "1",
        url: "https://example.test/1",
        title: "Backend Engineer",
        company: "Sample Company",
        apply_type: null,
        closed_at: null,
        captured_at: TWO_DAYS_AGO,
        updated_at: null,
        meta: {},
      },
    ],
    // Only a `created` event: the timeline would otherwise render the status label
    // too, and the doubling test below counts how often the status is named.
    events: [{ id: 1, job_id: "job-1", listing_id: "l1", event: "created", ts: TWO_DAYS_AGO }],
    documents: [],
    ...over,
  } as unknown as JobDetail;
}

async function show(job: JobDetail = makeJob(), attention: Attention | null = null) {
  mockedApi.getJob.mockResolvedValue(job);
  const onClose = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <DetailDrawer
        jobId={job.id}
        attention={attention}
        onClose={onClose}
        onEvent={vi.fn()}
        onNavigate={vi.fn()}
      />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Backend Engineer" });
  return { onClose, ...view };
}

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  vi.clearAllMocks();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const t of getToasts()) dismissToast(t.id);
});

describe("DetailDrawer — leaving the drawer", () => {
  // Esc and the backdrop both worked, and neither is visible; a touch user has no
  // Esc key at all.
  it("closes from a labelled Close button", async () => {
    const { onClose } = await show();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps Escape working when nothing is open inside it", async () => {
    const { onClose } = await show();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers a way out of the error state too", async () => {
    mockedApi.getJob.mockRejectedValue(new Error("boom"));
    const onClose = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DetailDrawer
          jobId="job-1"
          attention={null}
          onClose={onClose}
          onEvent={vi.fn()}
          onNavigate={vi.fn()}
        />
      </QueryClientProvider>,
    );
    // `useJob` sets `retry: 1`, so the error state follows one retry.
    await screen.findByText("Couldn’t load this job.", {}, { timeout: 5000 });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("DetailDrawer — the page behind it", () => {
  it("locks background scroll while open and restores it on close", async () => {
    expect(document.documentElement.classList.contains("overflow-hidden")).toBe(false);
    const { unmount } = await show();
    expect(document.documentElement.classList.contains("overflow-hidden")).toBe(true);
    expect(document.body.classList.contains("overflow-hidden")).toBe(true);
    unmount();
    expect(document.documentElement.classList.contains("overflow-hidden")).toBe(false);
    expect(document.body.classList.contains("overflow-hidden")).toBe(false);
  });

  it("keeps the header pinned to the top of the scroller", async () => {
    await show();
    const header = screen.getByRole("heading", { name: "Backend Engineer" }).closest("header")!;
    expect(header.className).toContain("sticky");
    expect(header.className).toContain("top-0");
  });
});

describe("DetailDrawer — remembered sections", () => {
  it("starts expanded and remembers independent section choices across jobs and remounts", async () => {
    const { unmount } = await show();
    for (const title of ["Listings", "Custom fields", "Documents", "Timeline"]) {
      expect(
        screen.getByRole("button", { name: `Collapse ${title}` }).getAttribute("aria-expanded"),
      ).toBe("true");
    }
    fireEvent.click(screen.getByRole("button", { name: "Collapse Listings" }));
    fireEvent.click(screen.getByRole("button", { name: "Collapse Documents" }));
    expect(screen.queryByRole("button", { name: "Delete listing" })).toBeNull();
    expect(JSON.parse(localStorage.getItem("jt.collapsedJobSections")!)).toEqual([
      "listings",
      "documents",
    ]);
    unmount();
    await show(makeJob({ id: "job-2" }));
    expect(
      screen.getByRole("button", { name: "Expand Listings" }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.getByRole("button", { name: "Expand Documents" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collapse Timeline" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Expand Listings" }));
    expect(screen.getByRole("button", { name: "Delete listing" })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("jt.collapsedJobSections")!)).toEqual(["documents"]);
  });

  it("opens a collapsed section when adding and preserves its draft while collapsed", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Custom fields" }));
    fireEvent.click(screen.getByRole("button", { name: "Add custom field" }));
    const name = screen.getByRole("combobox", { name: "Field name" }) as HTMLInputElement;
    const value = screen.getByRole("combobox", { name: "Field value" }) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Synthetic field" } });
    fireEvent.change(value, { target: { value: "Synthetic draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Collapse Custom fields" }));
    expect(screen.queryByRole("combobox", { name: "Field value" })).toBeNull();
    expect(value.isConnected).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Expand Custom fields" }));
    expect(screen.getByRole("combobox", { name: "Field value" })).toBe(value);
    expect(name.value).toBe("Synthetic field");
    expect(value.value).toBe("Synthetic draft");
    expect(mockedApi.updateJob).not.toHaveBeenCalled();
  });

  it("opens the collapsed timeline before an attention note request focuses its composer", async () => {
    await show(makeJob(), { stage: "in_process", since: TWO_DAYS_AGO, days: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Collapse Timeline" }));
    const panel = screen.getByText("Needs attention").parentElement!.parentElement!;
    fireEvent.click(within(panel).getByRole("button", { name: "Add note" }));
    const title = await screen.findByRole("combobox", { name: "Note title" });
    expect(
      screen.getByRole("button", { name: "Collapse Timeline" }).getAttribute("aria-expanded"),
    ).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(JSON.parse(localStorage.getItem("jt.collapsedJobSections")!)).toEqual([]);
  });
});

describe("DetailDrawer — copy full response JSON", () => {
  it("is a header button, not an overflow menu", async () => {
    await show();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy full response JSON" })).toBeTruthy();
  });

  it("copies the job and confirms with a toast", async () => {
    const job = makeJob();
    await show(job);
    fireEvent.click(screen.getByRole("button", { name: "Copy full response JSON" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(JSON.parse(writeText.mock.calls[0][0]).id).toBe("job-1");
    await waitFor(() => expect(getToasts()).toHaveLength(1));
    expect(getToasts()[0].kind).toBe("info");
  });

  // A refused clipboard write must report failure.
  it("says so when the clipboard write is refused", async () => {
    writeText.mockRejectedValue(new Error("Denied by the browser"));
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Copy full response JSON" }));

    await waitFor(() => expect(getToasts()).toHaveLength(1));
    expect(getToasts()[0].kind).toBe("error");
    expect(getToasts()[0].message).toContain("Denied by the browser");
  });
});

describe("DetailDrawer — closes on mutation success, not on click", () => {
  it("keeps the drawer open until deleting the last listing lands", async () => {
    const d = deferred<void>();
    mockedApi.deleteListing.mockReturnValue(d.promise);
    const { onClose } = await show();

    fireEvent.click(screen.getByRole("button", { name: "Delete listing" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mockedApi.deleteListing).toHaveBeenCalledWith("l1"));
    // In flight: the job still exists, so the drawer must still be on it.
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      d.resolve();
      await d.promise;
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("leaves the drawer open when the delete fails", async () => {
    const d = deferred<void>();
    mockedApi.deleteListing.mockReturnValue(d.promise);
    const { onClose } = await show();

    fireEvent.click(screen.getByRole("button", { name: "Delete listing" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mockedApi.deleteListing).toHaveBeenCalled());

    await act(async () => {
      d.reject(new Error("nope"));
      await d.promise.catch(() => {});
    });
    // Failure leaves the job visible for retry.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not close a job that still has other listings", async () => {
    const job = makeJob();
    const two = makeJob({
      listings: [...job.listings, { ...job.listings[0], id: "l2" }],
    });
    mockedApi.deleteListing.mockResolvedValue(undefined);
    const { onClose } = await show(two);

    fireEvent.click(screen.getAllByRole("button", { name: "Delete listing" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mockedApi.deleteListing).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on a successful job delete, not on the click", async () => {
    const d = deferred<void>();
    mockedApi.deleteJob.mockReturnValue(d.promise);
    const { onClose } = await show();

    fireEvent.click(screen.getByRole("button", { name: "Delete job" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mockedApi.deleteJob).toHaveBeenCalledWith("job-1"));
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      d.resolve();
      await d.promise;
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe("DetailDrawer — the status line names the stage once", () => {
  // The duration line must not repeat the stage named by the badge.
  it("reads '<span> in this stage', with the status named only by the badge", async () => {
    await show();
    expect(screen.getByText("in this stage", { exact: false })).toBeTruthy();
    expect(screen.getByText("2d")).toBeTruthy();
    expect(screen.queryByText(/In In process/)).toBeNull();
    expect(screen.getAllByText("In process")).toHaveLength(1);
  });

  // Missing status history must not leave a dangling separator.
  it("renders the added date without an orphaned separator", async () => {
    const { container } = await show();
    expect(screen.getByText(/^Added /)).toBeTruthy();
    expect(container.textContent).not.toContain("· Added ·");
  });
});
