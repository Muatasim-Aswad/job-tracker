import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request, toQuery } from "./index";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ApiError compatibility", () => {
  it.each([
    ['{"detail":{"revision":9}}', { detail: { revision: 9 } }],
    ['{"revision":9}', { revision: 9 }],
    ['{"detail":null}', { detail: null }],
    ['["summary"]', ["summary"]],
    ['"summary"', "summary"],
    ["42", 42],
    ["false", false],
    ["null", null],
    ["{malformed", undefined],
    ["plain text", undefined],
    ["", undefined],
  ])("adds a parsed payload without changing the raw message %s", (message, payload) => {
    const error = new ApiError(409, message);
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.name).toBe("ApiError");
    expect(error.status).toBe(409);
    expect(error.message).toBe(message);
    expect(error.payload).toEqual(payload);
  });

  it("keeps subclass constructors and names compatible", () => {
    class ConflictError extends ApiError {
      constructor(message: string) {
        super(409, message);
        this.name = "ConflictError";
      }
    }

    const error = new ConflictError('{"detail":{"revision":9}}');
    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      name: "ConflictError",
      status: 409,
      message: '{"detail":{"revision":9}}',
      payload: { detail: { revision: 9 } },
    });
  });
});

describe("request", () => {
  it.each([
    ['{"detail":{"revision":9}}', { detail: { revision: 9 } }],
    ['{"revision":9}', { revision: 9 }],
    ['{"detail":null}', { detail: null }],
    ['["summary"]', ["summary"]],
    ['"summary"', "summary"],
    ["42", 42],
    ["false", false],
    ["null", null],
    ["{malformed", undefined],
    ["plain text", undefined],
  ])("reads the failed body once and keeps message %s", async (body, payload) => {
    const response = new Response(body, { status: 409, statusText: "Conflict" });
    const text = vi.spyOn(response, "text");
    const json = vi.spyOn(response, "json");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const error = await request("/answers").catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ name: "ApiError", status: 409, message: body, payload });
    expect(text).toHaveBeenCalledTimes(1);
    expect(json).not.toHaveBeenCalled();
    expect(response.bodyUsed).toBe(true);
  });

  it("parses the failed message exactly once", async () => {
    const response = new Response('{"detail":{"revision":9}}', { status: 409 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const parse = vi.spyOn(JSON, "parse");
    await expect(request("/answers")).rejects.toBeInstanceOf(ApiError);
    expect(parse).toHaveBeenCalledExactlyOnceWith('{"detail":{"revision":9}}');
  });

  it.each([
    ["", "Conflict", undefined],
    ["unreadable", "Conflict", undefined],
    ["", '{"revision":9}', { revision: 9 }],
    ["unreadable", '{"revision":9}', { revision: 9 }],
    ["", "", undefined],
  ])("uses statusText %s / %s when the body is unavailable", async (body, statusText, payload) => {
    const response = new Response(body, { status: 409, statusText });
    const text = vi.spyOn(response, "text");
    if (body) text.mockRejectedValue(new Error("unreadable"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(request("/answers")).rejects.toMatchObject({
      status: 409,
      message: statusText,
      payload,
    });
    expect(text).toHaveBeenCalledTimes(1);
  });

  it("propagates the original network failure", async () => {
    const error = new TypeError("network unavailable");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    await expect(request("/answers")).rejects.toBe(error);
  });

  it("preserves the URL, request options and caller header precedence", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"saved":true}'));
    vi.stubGlobal("fetch", fetcher);
    const abort = new AbortController();
    const init = {
      method: "PATCH",
      headers: { "Content-Type": "application/custom", "X-Test": "synthetic" },
      body: '{"revision":9}',
      cache: "no-store",
      signal: abort.signal,
    } as const;
    await expect(request("/answers", init, "/api")).resolves.toEqual({ saved: true });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/answers", init);
  });

  it("defaults to relative requests and JSON headers", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("42"));
    vi.stubGlobal("fetch", fetcher);
    await expect(request("/count")).resolves.toBe(42);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/count", {
      headers: { "Content-Type": "application/json" },
    });
  });

  it("does not read a successful 204 body", async () => {
    const response = new Response(null, { status: 204 });
    const json = vi.spyOn(response, "json");
    const text = vi.spyOn(response, "text");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(request("/answers")).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
  });

  it("preserves invalid successful JSON failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("invalid JSON")));
    await expect(request("/answers")).rejects.toBeInstanceOf(SyntaxError);
  });
});

it("omits absent filters while retaining false, zero and escaping", () => {
  expect(toQuery({ absent: undefined, empty: "", flag: false, count: 0, q: "a & b" })).toBe(
    "?flag=false&count=0&q=a+%26+b",
  );
  expect(toQuery({ absent: undefined, empty: "" })).toBe("");
});
