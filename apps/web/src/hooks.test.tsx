// Guards optimistic updates and rollback through the cache writes the board sees.
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { JobSummary } from "@job-tracker/shared/api";

vi.mock("./api/client", () => ({
  api: {
    listJobs: vi.fn(),
    postEvents: vi.fn(),
    getJob: vi.fn(),
    listFormFillCaptures: vi.fn(),
    listFormFillQuestions: vi.fn(),
  },
}));

import { api } from "./api/client";
import { useFormFillReviewPresence, useJob, useJobEvents, useJobs } from "./hooks";

const mockedApi = vi.mocked(api);

function queryWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

describe("form-fill review presence", () => {
  it("asks for actionable Questions rather than every open Question", async () => {
    mockedApi.listFormFillCaptures.mockResolvedValue({ items: [], next_cursor: null } as never);
    mockedApi.listFormFillQuestions.mockResolvedValue({
      items: [{ id: "question-actionable" }],
      next_cursor: null,
    } as never);
    const { result } = renderHook(() => useFormFillReviewPresence(), {
      wrapper: queryWrapper(),
    });

    await waitFor(() => expect(result.current.hasQuestions).toBe(true));
    expect(result.current.hasCaptures).toBe(false);
    expect(mockedApi.listFormFillQuestions).toHaveBeenCalledWith({
      needs_review: true,
      limit: 1,
    });
  });
});

function makeJob(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    id: "job-1",
    title: "Engineer",
    title_key: "engineer",
    company: "Sample Company",
    company_key: "sample company",
    status: "new",
    hidden: false,
    starred: false,
    apply_types: [],
    platforms: [],
    listing_count: 1,
    primary_listing: null,
    attention: null,
    meta: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// One QueryClient shared by both hooks for the lifetime of a test, so the
// mutation's cache writes land where useJobs reads from — a fresh client per
// render (as a wrapper prop default would give) would reset the cache instead.
function setup(seed: JobSummary[]) {
  mockedApi.listJobs.mockResolvedValue(seed);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  const { result } = renderHook(() => ({ jobs: useJobs(), events: useJobEvents() }), {
    wrapper: Wrapper,
  });
  return { qc, result };
}

// Failed fetches remain distinct from loading and support bounded retry.
describe("useJob error state", () => {
  function renderUseJob() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    }
    return renderHook(() => useJob("job-1"), { wrapper: Wrapper });
  }

  it("surfaces isError instead of loading forever, and recovers on refetch", async () => {
    mockedApi.getJob.mockRejectedValue(new Error("network down"));
    const { result } = renderUseJob();

    // retry: 1 → one backed-off retry before the error is final.
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 10_000 });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();

    const job = { id: "job-1", title: "Engineer" };
    mockedApi.getJob.mockResolvedValue(job as never);
    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => expect(result.current.data).toMatchObject({ id: "job-1" }));
    expect(result.current.isError).toBe(false);
  });
});

describe("useJobEvents optimistic replay", () => {
  it("projects a status move and flag toggles onto the board before the response lands", async () => {
    const { result } = setup([makeJob()]);
    await waitFor(() => expect(result.current.jobs.data).toEqual([makeJob()]));

    // Never resolves during this test — proves the projection is applied
    // synchronously with the mutation, not after a round-trip.
    mockedApi.postEvents.mockReturnValue(new Promise(() => {}));

    act(() => {
      result.current.events.mutate({
        jobId: "job-1",
        events: [{ event: "seen" }, { event: "starred" }],
      });
    });

    await waitFor(() =>
      expect(result.current.jobs.data?.[0]).toMatchObject({ status: "seen", starred: true }),
    );
    // hidden/company/title etc. are untouched by the projection.
    expect(result.current.jobs.data?.[0]).toMatchObject({
      hidden: false,
      company: "Sample Company",
    });
  });

  it("leaves status untouched by a note while clearing attention", async () => {
    const { result } = setup([
      makeJob({
        status: "applied",
        attention: { stage: "applied", since: "2026-06-01T00:00:00Z", days: 30 },
      }),
    ]);
    await waitFor(() => expect(result.current.jobs.data?.[0].status).toBe("applied"));

    mockedApi.postEvents.mockReturnValue(new Promise(() => {}));
    act(() => {
      result.current.events.mutate({
        jobId: "job-1",
        events: [{ event: "note", meta: { note: "x" } }],
      });
    });

    await waitFor(() => expect(result.current.jobs.data?.[0].attention).toBeNull());
    expect(result.current.jobs.data?.[0].status).toBe("applied");
  });
});

describe("useJobEvents rollback", () => {
  it("reverts the optimistic projection when the server rejects the write", async () => {
    const original = makeJob({ status: "new" });
    const { result } = setup([original]);
    await waitFor(() => expect(result.current.jobs.data).toEqual([original]));

    mockedApi.postEvents.mockRejectedValue(new Error("boom"));

    await act(async () => {
      await result.current.events
        .mutateAsync({ jobId: "job-1", events: [{ event: "applied" }] })
        .catch(() => {});
    });

    await waitFor(() => expect(result.current.jobs.data).toEqual([original]));
  });

  it("reconciles with the server's authoritative state on success", async () => {
    const { result } = setup([makeJob({ status: "new" })]);
    await waitFor(() => expect(result.current.jobs.data?.[0].status).toBe("new"));

    mockedApi.postEvents.mockResolvedValue({ status: "applied", hidden: false, starred: true });
    // The successful mutation invalidates the summaries so server-derived fields
    // such as attention reconcile too; model that follow-up GET as authoritative.
    mockedApi.listJobs.mockResolvedValue([
      makeJob({ status: "applied", hidden: false, starred: true, attention: null }),
    ]);

    await act(async () => {
      await result.current.events.mutateAsync({ jobId: "job-1", events: [{ event: "applied" }] });
    });

    await waitFor(() =>
      expect(result.current.jobs.data?.[0]).toMatchObject({ status: "applied", starred: true }),
    );
  });
});
