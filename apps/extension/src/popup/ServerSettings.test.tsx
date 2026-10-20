import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ServerSettings } from "./ServerSettings";
import { connectServer } from "../config";

vi.mock("../config", () => ({
  SERVER_URL: "https://current.example.test",
  DEFAULT_SERVER_URL: "http://localhost:3456",
  normalizeServerUrl: (value: string) => new URL(value).origin,
  connectServer: vi.fn(async () => "https://current.example.test"),
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(connectServer).mockReset().mockResolvedValue("https://current.example.test");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ServerSettings reachable />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function click(label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  expect(button).not.toBeNull();
  await act(async () => button.click());
}

it("keeps the address editor hidden until requested and cancels without connecting", async () => {
  expect(container.textContent).toContain("current.example.test");
  expect(container.querySelector("input")).toBeNull();
  await click("Change server");
  await click("Restore default address");
  expect(container.querySelector("input")!.value).toBe("http://localhost:3456");
  expect(connectServer).not.toHaveBeenCalled();
  await click("Cancel editing");
  await click("Change server");
  expect(container.querySelector("input")!.value).toBe("https://current.example.test");
});

it("saves the default address only after the checkmark is pressed", async () => {
  await click("Change server");
  await click("Restore default address");
  await click("Test and save server");
  expect(connectServer).toHaveBeenCalledExactlyOnceWith("http://localhost:3456", true);
  expect(container.querySelector("input")).toBeNull();
});

it("retains the editor and displays an inline connection failure", async () => {
  vi.mocked(connectServer).mockRejectedValueOnce(new Error("Server access was not granted."));
  await click("Change server");
  await click("Test and save server");
  expect(container.querySelector('[role="alert"]')!.textContent).toBe(
    "Server access was not granted.",
  );
  expect(container.querySelector("input")!.value).toBe("https://current.example.test");
  expect(container.textContent).toContain("current.example.test");
});
