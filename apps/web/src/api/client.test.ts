import { afterEach, expect, it, vi } from "vitest";
import { api } from "./client";

afterEach(() => vi.unstubAllGlobals());
it("sends settings patches with their revision and bypasses caches", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ revision: "new", settings: {} })));
  vi.stubGlobal("fetch", fetcher);
  await api.updateExtensionSettings({ easy_apply_enabled: false }, "old");
  expect(fetcher).toHaveBeenCalledWith(
    "/api/settings",
    expect.objectContaining({
      method: "PATCH",
      cache: "no-store",
      body: JSON.stringify({ changes: { easy_apply_enabled: false }, expected_revision: "old" }),
    }),
  );
});
it.each([409, 500])("shows safe settings errors for status %s", async (status) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private response", { status })));
  await expect(api.getExtensionSettings()).rejects.toThrow(
    status === 409
      ? "Settings changed elsewhere. Reload settings before saving again."
      : "Couldn’t load or save extension settings. Check your connection and try again.",
  );
});

it("clears diagnostics through the server endpoint", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  await api.clearSearchLog();
  expect(fetcher).toHaveBeenCalledWith(
    "/api/search-log",
    expect.objectContaining({ method: "DELETE", cache: "no-store" }),
  );
});
