import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useDraftGuard } from "../form-fill/draftGuard";
import { reloadBuild } from "./reloadBuild";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("preserves an unsaved draft when reload is declined and retains the native unload guard", () => {
  renderHook(() => useDraftGuard(true));
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const reload = vi.fn();
  reloadBuild(reload);
  expect(reload).not.toHaveBeenCalled();
  expect(confirm).toHaveBeenCalledWith("Discard your unsaved changes?");
  const unload = new Event("beforeunload", { cancelable: true });
  expect(window.dispatchEvent(unload)).toBe(false);
  confirm.mockReturnValue(true);
  reloadBuild(reload);
  expect(reload).toHaveBeenCalledOnce();
});
it("reloads a clean page without a discard prompt", () => {
  const confirm = vi.spyOn(window, "confirm");
  const reload = vi.fn();
  reloadBuild(reload);
  expect(reload).toHaveBeenCalledOnce();
  expect(confirm).not.toHaveBeenCalled();
});
