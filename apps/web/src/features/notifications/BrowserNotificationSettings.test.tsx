import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserNotificationSettings } from "./BrowserNotificationSettings";
vi.mock("./push", () => ({
  pushSupported: () => true,
  pushEnabled: async () => false,
  enablePush: vi.fn(),
  disablePush: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("does not offer a permission action when the browser has blocked notifications", async () => {
  vi.stubGlobal("Notification", { permission: "denied" });
  render(<BrowserNotificationSettings disabled={false} />);
  await waitFor(() => expect(screen.queryByText("Checking…")).toBeNull());
  expect(screen.queryByRole("button", { name: "Allow" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
  expect(screen.getByText("Blocked in browser")).toBeTruthy();
});
