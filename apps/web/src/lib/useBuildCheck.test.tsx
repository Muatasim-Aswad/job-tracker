import { StrictMode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useBuildCheck } from "./useBuildCheck";
import { stubStorage } from "../test/storage";
import { runningBuild, type BuildInfo } from "./buildInfo";

const mocks = vi.hoisted(() => ({ notice: vi.fn() }));
vi.mock("./toast", () => ({ toast: { info: mocks.notice } }));
const newer: BuildInfo = {
  version: "1.2.1",
  revision: "f".repeat(40),
  commit_time: "2026-10-13T09:00:00Z",
  build_time: "1980-01-01T00:00:00Z",
  dev: false,
};
beforeEach(() => {
  stubStorage();
  mocks.notice.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("checks on mount and focus, with a single revision notice and no reload", async () => {
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(newer)));
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(useBuildCheck);
  await waitFor(() => expect(result.current.result.status).toBe("checked"));
  expect(mocks.notice).toHaveBeenCalledOnce();
  expect(mocks.notice.mock.calls[0][0]).toContain("Open About in the menu");
  act(() => {
    window.dispatchEvent(new Event("focus"));
  });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(result.current.result.status).toBe("checked"));
  expect(mocks.notice).toHaveBeenCalledOnce();
});
it("reports a failed check and recovers with a manual check, without announcing the matching build", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("private error"))
    .mockResolvedValueOnce(new Response(JSON.stringify(runningBuild)));
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(useBuildCheck);
  await waitFor(() => expect(result.current.result).toEqual({ status: "failed" }));
  act(() => result.current.check());
  await waitFor(() =>
    expect(result.current.result).toEqual({ status: "checked", current: runningBuild }),
  );
  expect(mocks.notice).not.toHaveBeenCalled();
});
it("deduplicates active checks and cancels them on unmount", async () => {
  const fetcher = vi.fn().mockReturnValue(new Promise(() => {}));
  vi.stubGlobal("fetch", fetcher);
  const { result, unmount } = renderHook(useBuildCheck);
  act(() => {
    result.current.check();
    window.dispatchEvent(new Event("focus"));
  });
  expect(fetcher).toHaveBeenCalledOnce();
  unmount();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
});
it("does not announce dev builds or canceled StrictMode requests", async () => {
  const dev = { ...runningBuild, version: "9.9.9", revision: "dev", commit_time: null, dev: true };
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(dev)));
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(useBuildCheck, { wrapper: StrictMode });
  await waitFor(() => expect(result.current.result.status).toBe("checked"));
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  expect(mocks.notice).not.toHaveBeenCalled();
});
