import type { components } from "./schema";

// Typed FastAPI fetch primitive. `baseUrl` supports relative same-origin calls or an
// explicitly configured API origin.

export type ApiErrorPayload =
  | null
  | boolean
  | number
  | string
  | ApiErrorPayload[]
  | { [key: string]: ApiErrorPayload };

export type HttpApiError = Omit<components["schemas"]["HttpError"], "details"> & {
  details?: ApiErrorPayload;
};

function httpError(payload: ApiErrorPayload | undefined, status: number): HttpApiError | undefined {
  if (!payload || typeof payload !== "object" || !("error" in payload)) return;
  const value = payload.error;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.status !== status ||
    typeof value.code !== "string" ||
    typeof value.message !== "string" ||
    typeof value.request_id !== "string"
  )
    return;
  return value as unknown as HttpApiError;
}

function parseErrorPayload(message: string): ApiErrorPayload | undefined {
  try {
    return JSON.parse(message) as ApiErrorPayload;
  } catch {
    return undefined;
  }
}

export class ApiError extends Error {
  status: number;
  readonly payload: ApiErrorPayload | undefined;
  readonly code: string | undefined;
  readonly requestId: string | undefined;
  readonly details: ApiErrorPayload | undefined;
  readonly issues: HttpApiError["issues"];

  constructor(status: number, message: string, context?: { code?: string; requestId?: string }) {
    const payload = parseErrorPayload(message);
    const error = httpError(payload, status);
    super(error?.message ?? message);
    this.status = status;
    this.name = "ApiError";
    this.payload = payload;
    this.code = error?.code ?? context?.code;
    this.requestId = error?.request_id ?? context?.requestId;
    this.details = error?.details;
    this.issues = error?.issues;
  }
}

// Omit absent and empty-string filters; preserve false and zero.
export function toQuery(params: Record<string, string | number | boolean | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export async function request<T>(path: string, init?: RequestInit, baseUrl = ""): Promise<T> {
  // Callers supply headers as plain records.
  const headers = init?.headers as Record<string, string> | undefined;
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body || res.statusText, {
      requestId: res.headers.get("X-Request-ID") ?? undefined,
    });
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
