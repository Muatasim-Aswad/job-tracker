// `false_matches` is server-owned duplicate-suppression state. The editor must hide
// it and preserve its array value whenever it writes the surrounding metadata bag.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { JobDetail } from "@job-tracker/shared/api";
import { MetaEditor } from "./MetaEditor";

vi.mock("./client", () => ({
  api: {
    updateJob: vi.fn(() => new Promise(() => {})),
    metaVocabulary: vi.fn(() => Promise.resolve({ keys: [] })),
  },
}));

import { api } from "./client";

const mockedApi = vi.mocked(api);

function makeJob(meta: Record<string, unknown>): JobDetail {
  return {
    id: "job-1",
    title: "Engineer",
    title_key: "engineer",
    company: "Sample Company",
    company_key: "sample company",
    status: "seen",
    hidden: false,
    starred: false,
    meta,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    listings: [],
    events: [],
    documents: [],
  } as unknown as JobDetail;
}

function renderEditor(meta: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MetaEditor job={makeJob(meta)} />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("MetaEditor", () => {
  it("is titled in the user's words, not the column's", () => {
    renderEditor({ recruiter: "Dana" });
    expect(screen.getByRole("heading", { name: "Custom fields (1)" })).toBeTruthy();
  });

  it("renders no card, and no edit or delete control, for false_matches", () => {
    renderEditor({ false_matches: ["job-2", "job-3"] });

    expect(screen.queryByText("false_matches")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit false_matches" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete false_matches" })).toBeNull();
  });

  it("does not count false_matches, so a job with only it reads as empty", () => {
    renderEditor({ false_matches: ["job-2"] });

    expect(screen.getByRole("heading", { name: "Custom fields (0)" })).toBeTruthy();
  });

  it("keeps false_matches on the job when a neighbouring field is edited", async () => {
    renderEditor({ false_matches: ["job-2"], recruiter: "Dana" });

    fireEvent.click(screen.getByRole("button", { name: "Edit recruiter" }));
    const value = screen.getByDisplayValue("Dana");
    fireEvent.change(value, { target: { value: "Sam" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    await waitFor(() => expect(mockedApi.updateJob).toHaveBeenCalledTimes(1));
    const [, body] = mockedApi.updateJob.mock.calls[0]!;
    // Preserve both the value and its array type.
    expect(body.meta!.false_matches).toEqual(["job-2"]);
    expect(body.meta!.recruiter).toBe("Sam");
  });

  it("refuses to create a field named after a system key", () => {
    renderEditor({ false_matches: ["job-2"] });

    fireEvent.click(screen.getByRole("button", { name: "Add custom field" }));
    fireEvent.change(screen.getByPlaceholderText("field"), {
      target: { value: "false_matches" },
    });

    const addButton = screen.getByRole("button", { name: /^Add$/ });
    expect(addButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(addButton);
    expect(mockedApi.updateJob).not.toHaveBeenCalled();
  });

  it("teaches with suggestion chips even when the shared vocabulary is empty", async () => {
    renderEditor({});

    fireEvent.click(screen.getByRole("button", { name: "Add custom field" }));
    expect(await screen.findByRole("button", { name: "+ recruiter" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ referral" })).toBeTruthy();
  });

  it("carries the whole empty state in the header, with no block below it", () => {
    renderEditor({});

    expect(screen.queryByText("No custom fields yet.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add custom field" }));
    expect(screen.getByPlaceholderText("field")).toBeTruthy();
  });

  it("names the key and value inputs, not only their placeholders", () => {
    renderEditor({});

    fireEvent.click(screen.getByRole("button", { name: "Add custom field" }));
    expect(screen.getByRole("combobox", { name: "Field name" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Field value" })).toBeTruthy();
  });
});
