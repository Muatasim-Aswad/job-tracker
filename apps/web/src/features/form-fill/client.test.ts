import { afterEach, describe, expect, it, vi } from "vitest";
import { api, FormFillApiError } from "./client";
import { ApiError } from "../../infra/http";
import { describeError } from "../../shared/toast";

afterEach(() => vi.unstubAllGlobals());

describe("form-fill API privacy boundary", () => {
  it.each([
    ['{"detail":{"revision":9}}', { revision: 9 }],
    ['{"revision":9}', { revision: 9 }],
    ['{"detail":null,"revision":9}', { detail: null, revision: 9 }],
    ['{"detail":false}', false],
    ['{"detail":0}', 0],
    ['{"detail":""}', ""],
    ['["summary"]', ["summary"]],
    ['"summary"', "summary"],
    ["42", 42],
    ["false", false],
    ["null", undefined],
    ["{malformed", undefined],
    ["plain text", undefined],
    ["", undefined],
  ])("preserves the conflict projection for body %s", async (body, current) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 409, statusText: "Conflict" })),
    );
    const error = await api.getFormFillAnswer("answer-1").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(FormFillApiError);
    expect(error).toMatchObject({
      name: "FormFillApiError",
      status: 409,
      message: "This changed while you were looking at it. Your change was not applied.",
      current,
    });
  });

  it.each(["", "unreadable"])("preserves statusText projection for a %s body", async (body) => {
    const response = new Response(body, { status: 409, statusText: '{"revision":9}' });
    if (body) vi.spyOn(response, "text").mockRejectedValue(new Error("unreadable"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(api.getFormFillAnswer("answer-1")).rejects.toMatchObject({
      current: { revision: 9 },
    });
  });

  it("does not wrap network failures", async () => {
    const error = new TypeError("network unavailable");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    await expect(api.getFormFillAnswer("answer-1")).rejects.toBe(error);
  });

  it("preserves a directly constructed ApiError's conflict payload", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new ApiError(409, '{"revision":9}')));
    await expect(api.getFormFillAnswer("answer-1")).rejects.toMatchObject({
      current: { revision: 9 },
    });
  });

  it("preserves subclass identity and direct construction", () => {
    const current = { revision: 9 };
    const error = new FormFillApiError(409, "safe summary", current);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      name: "FormFillApiError",
      status: 409,
      message: "safe summary",
    });
    expect(error.current).toBe(current);
    expect(error.payload).toBeUndefined();
  });

  it("keeps non-conflict private data out of global errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"detail":{"value":"private fixture value"}}', { status: 500 }),
        ),
    );
    const error = await api.getFormFillAnswer("answer-1").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(FormFillApiError);
    expect(error).toMatchObject({
      status: 500,
      message: "The form-fill request could not be completed.",
      current: undefined,
    });
    expect(describeError(error)).toBe(
      "Request failed (500): The form-fill request could not be completed.",
    );
    expect(JSON.stringify(error)).not.toContain("private fixture value");
  });

  it("does not carry the transport payload into a safe conflict error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('{"private":"private fixture value","detail":{"revision":9}}', {
          status: 409,
        }),
      ),
    );
    const error = await api.getFormFillAnswer("answer-1").catch((reason: unknown) => reason);
    expect(error).toMatchObject({ current: { revision: 9 }, payload: undefined });
    expect(describeError(error)).toBe(
      "Request failed (409): This changed while you were looking at it. Your change was not applied.",
    );
    expect(JSON.stringify(error)).not.toContain("private fixture value");
  });

  it("accepts a transport ApiError subclass without forwarding its private payload", async () => {
    class ConflictError extends ApiError {}
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          new ConflictError(409, '{"private":"private fixture value","detail":{"revision":9}}'),
        ),
    );
    await expect(api.getFormFillAnswer("answer-1")).rejects.toMatchObject({
      name: "FormFillApiError",
      current: { revision: 9 },
      payload: undefined,
    });
  });

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

  it("requests candidates by opaque question ID without putting prompts or values in URLs", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [], next_cursor: null }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await api.listFormFillAnswerCandidates("question-1", { cursor: "opaque-cursor", limit: 30 });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "/api/form-fill/questions/question-1/answer-candidates?cursor=opaque-cursor&limit=30",
    );
  });
});

it("projects standard conflicts without retaining a private transport payload", async () => {
  const envelope = {
    error: {
      status: 409,
      code: "stale_revision",
      request_id: "request-1",
      message: "PRIVATE SERVER MESSAGE",
      details: { current: { revision: 4 } },
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(envelope), { status: 409 })),
  );
  const error = await api.getFormFillAnswer("answer-1").catch((value: unknown) => value);
  expect(error).toMatchObject({
    code: "stale_revision",
    requestId: "request-1",
    current: { revision: 4 },
    payload: undefined,
    details: undefined,
  });
  expect(describeError(error)).not.toContain("PRIVATE SERVER MESSAGE");
});
