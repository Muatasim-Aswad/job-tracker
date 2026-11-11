import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreferencesState } from "@job-tracker/shared/api";
import { toast } from "../../shared/toast";
import { api } from "./client";
import { ExtensionSettingsDialog } from "./ExtensionSettingsDialog";

vi.mock("./client", () => ({
  api: { getExtensionSettings: vi.fn(), updateExtensionSettings: vi.fn(), clearSearchLog: vi.fn() },
}));
const initial: PreferencesState = {
  revision: "one",
  settings: {
    notifications: { muted: false },
    application_staleness: {
      applied_notifications: "on",
      in_process_notifications: "on",
      applied_days: 21,
      in_process_days: 14,
      notification_time: "09:00",
      timezone: "UTC",
    },
    easy_apply_enabled: true,
    hide_mode: "remove",
    search_diagnostics: { scope: "never", expires_at: null },
    description_highlights: [{ id: "custom-words", enabled: false, terms: [] }],
    title_rules: [
      { id: "rule", enabled: true, terms: ["senior"], match: "contains", action: "star" },
    ],
  },
};
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const close = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ExtensionSettingsDialog onClose={close} />
    </QueryClientProvider>,
  );
  return { client, close };
}
beforeEach(() => {
  vi.mocked(api.getExtensionSettings).mockResolvedValue(structuredClone(initial));
  vi.mocked(api.clearSearchLog).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe("Extension settings", () => {
  it("saves shared settings with the fetched revision and preserves empty disabled highlights", async () => {
    vi.mocked(api.updateExtensionSettings).mockImplementation(async (settings) => ({
      revision: "two",
      settings: { ...initial.settings, ...settings },
    }));
    mount();
    const save = (await screen.findByRole("button", {
      name: "Save settings",
    })) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText("Description highlights").closest("details")?.open).toBe(false);
    expect(screen.queryByText("Press Enter to add a keyword.")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Job browsing" })).toBeNull();
    expect(screen.getByText("Keyword actions").closest("details")?.open).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "Fill Easy Apply forms" }));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await screen.findByText("Settings saved.");
    expect(api.updateExtensionSettings).toHaveBeenCalledWith(
      { ...initial.settings, easy_apply_enabled: false },
      "one",
    );
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByText("Description highlights"));
    expect(
      (screen.getByRole("checkbox", { name: "Role and custom words" }) as HTMLInputElement).checked,
    ).toBe(false);
  });
  it("replaces the rule list while editing and restores it on Cancel editing", async () => {
    mount();
    fireEvent.click(await screen.findByText("Keyword actions"));
    expect(screen.getByText("Keyword actions").closest("details")?.open).toBe(true);
    fireEvent.click(screen.getByText("Keyword actions"));
    expect(screen.getByText("Keyword actions").closest("details")?.open).toBe(false);
    fireEvent.click(screen.getByText("Keyword actions"));
    fireEvent.click(screen.getByRole("button", { name: "Edit rule: senior" }));
    expect(screen.queryByRole("button", { name: "Edit rule: senior" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Job browsing" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Description highlights" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Edit title rule" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Apply rule" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Title condition" }), {
      target: { value: "not_contains" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Rule keywords" }), {
      target: { value: "junior, trainee" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
    fireEvent.click(screen.getByText("Keyword actions"));
    expect(screen.getByRole("button", { name: "Edit rule: senior" })).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect((screen.getByRole("button", { name: "Apply rule" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Title condition" }), {
      target: { value: "not_contains" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Rule keywords" }), {
      target: { value: "junior, trainee, junior" },
    });
    vi.mocked(api.updateExtensionSettings).mockImplementation(async (settings) => ({
      revision: "two",
      settings: { ...initial.settings, ...settings },
    }));
    fireEvent.click(screen.getByRole("button", { name: "Apply rule" }));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await screen.findByText("Settings saved.");
    expect(vi.mocked(api.updateExtensionSettings).mock.calls[0][0].title_rules?.[1]).toMatchObject({
      match: "not_contains",
      terms: ["junior", "trainee"],
    });
  });
  it("edits highlight chips and includes a pending keyword when saving", async () => {
    vi.mocked(api.updateExtensionSettings).mockImplementation(async (settings) => ({
      revision: "two",
      settings: { ...initial.settings, ...settings },
    }));
    mount();
    fireEvent.click(await screen.findByText("Description highlights"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Role and custom words" }));
    const input = screen.getByRole("textbox", { name: "Role and custom words keywords" });
    fireEvent.change(input, { target: { value: "senior" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Remove senior" })).toBeTruthy();
    expect(api.updateExtensionSettings).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "lead" } });
    fireEvent.click(screen.getByText("Description highlights"));
    expect(screen.getByText("Description highlights").closest("details")?.open).toBe(false);
    fireEvent.click(screen.getByText("Description highlights"));
    expect(
      (screen.getByRole("textbox", { name: "Role and custom words keywords" }) as HTMLInputElement)
        .value,
    ).toBe("lead");

    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await screen.findByText("Settings saved.");
    expect(vi.mocked(api.updateExtensionSettings).mock.calls[0][0].description_highlights).toEqual([
      { id: "custom-words", enabled: true, terms: ["senior", "lead"] },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Remove senior" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove lead" }));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(api.updateExtensionSettings).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.updateExtensionSettings).mock.calls[1][0].description_highlights).toEqual([
      { id: "custom-words", enabled: true, terms: [] },
    ]);
  });
  it("deduplicates pasted chips and supports keyboard removal", async () => {
    mount();
    fireEvent.click(await screen.findByText("Description highlights"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Role and custom words" }));
    const input = screen.getByRole("textbox", { name: "Role and custom words keywords" });
    fireEvent.paste(input, { clipboardData: { getData: () => "senior, Senior\nlead" } });
    expect(screen.getByRole("button", { name: "Remove senior" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove Senior" })).toBeNull();
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(screen.queryByRole("button", { name: "Remove lead" })).toBeNull();
  });
  it("keeps diagnostics collapsed, explains capture in a tooltip, and stages scope changes", async () => {
    mount();
    const summary = await screen.findByText("Search diagnostics");
    expect(summary.closest("details")?.open).toBe(false);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.click(summary);
    const info = screen.getByRole("button", { name: "About search diagnostics" });
    fireEvent.focus(info);
    expect(screen.getByRole("tooltip").textContent).toContain("automatic search seed");
    fireEvent.blur(info);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Capture search diagnostics" }), {
      target: { value: "temporary" },
    });
    expect(
      (screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(api.updateExtensionSettings).not.toHaveBeenCalled();
  });
  it("clears stored diagnostics separately from unsaved settings, with confirmation and feedback", async () => {
    mount();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Fill Easy Apply forms" }));
    fireEvent.click(screen.getByText("Search diagnostics"));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Clear stored data" }));
    expect(api.clearSearchLog).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    let finish!: () => void;
    vi.mocked(api.clearSearchLog).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear stored data" }));
    expect((screen.getByRole("button", { name: "Clearing…" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => finish());
    await screen.findByText("Stored search diagnostics cleared.");
    expect(api.clearSearchLog).toHaveBeenCalledOnce();
    expect(api.updateExtensionSettings).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("checkbox", { name: "Fill Easy Apply forms" }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    confirm.mockRestore();
  });
  it("reports diagnostic clearing failures without exposing response details", async () => {
    vi.mocked(api.clearSearchLog).mockRejectedValue(new Error("private response"));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    mount();
    fireEvent.click(await screen.findByText("Search diagnostics"));
    fireEvent.click(screen.getByRole("button", { name: "Clear stored data" }));
    await screen.findByText(
      "Couldn’t clear search diagnostics. Check your connection and try again.",
    );
    expect(screen.queryByText("private response")).toBeNull();
    confirm.mockRestore();
  });
  it("keeps dirty edits through background refresh and conflicts, and guards closing", async () => {
    vi.mocked(api.updateExtensionSettings).mockRejectedValue(
      new Error("Settings changed elsewhere. Reload settings before saving again."),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { client, close } = mount();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Fill Easy Apply forms" }));
    await act(async () => {
      client.setQueryData(["extension-settings"], { ...initial, revision: "other" });
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await screen.findByText("Settings changed elsewhere. Reload settings before saving again.");
    expect(vi.mocked(api.updateExtensionSettings).mock.calls[0][1]).toBe("one");
    expect(
      (screen.getByRole("checkbox", { name: "Fill Easy Apply forms" }) as HTMLInputElement).checked,
    ).toBe(false);
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Close settings" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(confirm).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    const feedback = vi.spyOn(toast, "info");
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Reload settings" }));
    await waitFor(() =>
      expect(
        (screen.getByRole("checkbox", { name: "Fill Easy Apply forms" }) as HTMLInputElement)
          .checked,
      ).toBe(true),
    );
    expect(feedback).toHaveBeenCalledWith("Settings reloaded.");
    feedback.mockRestore();
    confirm.mockRestore();
  });
  it("retries loading without exposing server error bodies", async () => {
    vi.mocked(api.getExtensionSettings).mockRejectedValueOnce(new Error("private server response"));
    mount();
    await screen.findByRole("alert");
    expect(screen.queryByText("private server response")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("button", { name: "Save settings" });
  });
});

it("saves independent stale alert modes and global mute in matching collapsed sections", async () => {
  vi.mocked(api.updateExtensionSettings).mockImplementation(async (settings) => ({
    revision: "two",
    settings: { ...initial.settings, ...settings },
  }));
  mount();
  const stale = await screen.findByText("Stale applications");
  const notifications = screen.getByText("Notifications");
  expect(stale.closest("details")?.open).toBe(false);
  expect(notifications.closest("details")?.open).toBe(false);
  fireEvent.click(stale);
  expect(stale.closest("details")!.querySelector("select")).toBeNull();
  expect((screen.getByLabelText("Applied (days)") as HTMLInputElement).value).toBe("21");
  fireEvent.click(notifications);
  expect(screen.queryByLabelText("Time zone")).toBeNull();
  expect(screen.queryByText("Time zone: UTC (automatic).")).toBeNull();
  fireEvent.focus(screen.getByRole("button", { name: "About Daily stale alert time" }));
  expect(await screen.findByRole("tooltip")).toHaveProperty(
    "textContent",
    "Time zone: UTC (automatic).",
  );
  fireEvent.blur(screen.getByRole("button", { name: "About Daily stale alert time" }));
  fireEvent.change(screen.getByLabelText("Applied stale alerts"), { target: { value: "off" } });
  fireEvent.change(screen.getByLabelText("In process stale alerts"), {
    target: { value: "muted" },
  });
  expect((screen.getByLabelText("Applied (days)") as HTMLInputElement).value).toBe("21");
  expect((screen.getByLabelText("In process (days)") as HTMLInputElement).value).toBe("14");
  fireEvent.click(screen.getByRole("checkbox", { name: "Mute all notifications" }));
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await screen.findByText("Settings saved.");
  expect(api.updateExtensionSettings).toHaveBeenCalledWith(
    {
      ...initial.settings,
      notifications: { muted: true },
      application_staleness: {
        ...initial.settings.application_staleness,
        applied_notifications: "off",
        in_process_notifications: "muted",
      },
    },
    "one",
  );
});
