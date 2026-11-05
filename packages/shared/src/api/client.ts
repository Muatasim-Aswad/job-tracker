// Typed FastAPI fetch primitive. `baseUrl` supports relative same-origin calls or an
// explicitly configured API origin.

export type ApiErrorPayload =
  | null
  | boolean
  | number
  | string
  | ApiErrorPayload[]
  | { [key: string]: ApiErrorPayload };

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

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
    this.payload = parseErrorPayload(message);
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
    throw new ApiError(res.status, body || res.statusText);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
