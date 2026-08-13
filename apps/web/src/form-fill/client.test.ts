import { afterEach, describe, expect, it, vi } from "vitest";
import { api, FormFillApiError } from "../api/client";

afterEach(() => vi.unstubAllGlobals());

describe("form-fill API privacy boundary", () => {
  it("uses a value-free error message for the global toast path", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ detail: { revision: 9, value: "private fixture value" } }),
            { status: 409, statusText: "Conflict" },
          ),
        ),
    );
    const error = await api
      .updateFormFillAnswer("answer-1", { expected_revision: 2 })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(FormFillApiError);
    expect((error as FormFillApiError).message).not.toContain("private fixture value");
    expect((error as FormFillApiError).status).toBe(409);
  });

  it("places only filters and opaque cursors in list URLs", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [], next_cursor: null }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await api.listFormFillAnswers({ status: "active", cursor: "opaque-cursor", limit: 1 });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "/api/form-fill/answers?status=active&cursor=opaque-cursor&limit=1",
    );
  });
});
