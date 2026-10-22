import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { KeywordSettings } from "./KeywordSettings";

vi.mock("../config", () => ({ SERVER_URL: "https://tracker.example.test" }));
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<KeywordSettings />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("links to the configured server's settings and shows only the management link", () => {
  const link = container.querySelector<HTMLAnchorElement>("a")!;
  expect(link.textContent).toContain("Manage keyword highlights and rules");
  expect(link.href).toBe("https://tracker.example.test/?view=jobs&settings=extension");
  expect(link.target).toBe("_blank");
  expect(container.querySelector("form")).toBeNull();
  expect(container.querySelector('input[placeholder="Add keyword…"]')).toBeNull();
  expect(container.textContent).not.toContain("Description highlights");
  expect(container.textContent).not.toContain("Clear stored data");
  expect(container.querySelector("input")).toBeNull();
  expect(container.querySelector("details")).toBeNull();
  expect(container.querySelector("button")).toBeNull();
});
