import { presentOnce } from "./notificationReceipts";

export interface PushPublication {
  id: string;
  published_at: string;
  title: string;
  body: string | null;
  job_id: string | null;
}

export function parsePush(value: unknown): PushPublication | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<PushPublication>;
  if (
    typeof item.id !== "string" ||
    typeof item.published_at !== "string" ||
    typeof item.title !== "string"
  )
    return null;
  return {
    id: item.id,
    published_at: item.published_at,
    title: item.title,
    body: typeof item.body === "string" ? item.body : null,
    job_id: typeof item.job_id === "string" ? item.job_id : null,
  };
}

export async function acknowledgePush(item: PushPublication, read = false): Promise<void> {
  const response = await fetch(
    `/api/notifications/${encodeURIComponent(item.id)}/${read ? "read" : "ack"}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ published_at: item.published_at }),
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok && response.status !== 409 && response.status !== 404)
    throw new Error("Notification acknowledgment failed");
}

export async function receivePush(
  registration: ServiceWorkerRegistration,
  item: PushPublication,
): Promise<void> {
  const response = await fetch(`/api/notifications/${encodeURIComponent(item.id)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 404) return;
  if (!response.ok) throw new Error("Couldn’t verify notification");
  const current = (await response.json()) as {
    published_at?: string;
    state?: string;
    read_at?: string | null;
    resolved_at?: string | null;
    alert_suppressed_at?: string | null;
  };
  if (
    current.published_at !== item.published_at ||
    current.state !== "published" ||
    current.read_at ||
    current.resolved_at ||
    current.alert_suppressed_at
  )
    return;
  await presentOnce(`${item.id}:${item.published_at}`, () =>
    registration.showNotification(item.title, {
      body: item.body ?? undefined,
      tag: `${item.id}:${item.published_at}`,
      icon: "/pwa-192.png",
      data: item,
    }),
  );
  await acknowledgePush(item).catch(() => {});
}

export function notificationTarget(item: PushPublication, origin: string): string {
  const url = new URL("/", origin);
  url.searchParams.set("view", "jobs");
  if (item.job_id) url.searchParams.set("job", item.job_id);
  else url.searchParams.set("notification", item.id);
  return url.href;
}
