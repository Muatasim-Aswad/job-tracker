import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PreferencesState } from "@job-tracker/shared/api";
import { api } from "../extension-settings/client";
import { useNotificationTimeZone } from "./useNotificationTimeZone";

vi.mock("../extension-settings/client", () => ({
  api: { getExtensionSettings: vi.fn(), updateExtensionSettings: vi.fn() },
}));
const current = {
  revision: "current",
  settings: {
    application_staleness: {
      applied_days: 21,
      in_process_days: 14,
      applied_notifications: "muted",
      in_process_notifications: "off",
      notification_time: "09:00",
      timezone: "UTC",
    },
  },
} as PreferencesState;

function Connected() {
  useNotificationTimeZone();
  return null;
}
function mount() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Connected />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.mocked(api.getExtensionSettings).mockResolvedValue(current);
  vi.mocked(api.updateExtensionSettings).mockResolvedValue(current);
  const options = Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    ...options,
    timeZone: "Europe/Amsterdam",
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("reports the active device timezone with the current revision while preserving alert rules", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const { unmount } = mount();
  await waitFor(() =>
    expect(api.updateExtensionSettings).toHaveBeenCalledWith(
      {
        application_staleness: {
          ...current.settings.application_staleness,
          timezone: "Europe/Amsterdam",
        },
      },
      "current",
      expect.any(AbortSignal),
    ),
  );
  const signal = vi.mocked(api.getExtensionSettings).mock.calls[0][0]!;
  unmount();
  expect(signal.aborted).toBe(true);
});

it("does not let a background dashboard change the scheduling timezone", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  mount();
  expect(api.getExtensionSettings).not.toHaveBeenCalled();
  visibility.mockReturnValue("visible");
  fireEvent(document, new Event("visibilitychange"));
  await waitFor(() => expect(api.updateExtensionSettings).toHaveBeenCalledOnce());
});

it("does not write settings when the detected timezone already matches", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.mocked(api.getExtensionSettings).mockResolvedValue({
    ...current,
    settings: {
      ...current.settings,
      application_staleness: {
        ...current.settings.application_staleness,
        timezone: "Europe/Amsterdam",
      },
    },
  });
  mount();
  await waitFor(() => expect(api.getExtensionSettings).toHaveBeenCalledOnce());
  expect(api.updateExtensionSettings).not.toHaveBeenCalled();
});
