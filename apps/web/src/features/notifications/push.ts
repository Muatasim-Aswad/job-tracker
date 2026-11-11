import { request } from "../../infra/http";

export function pushSupported(): boolean {
  return (
    typeof Notification !== "undefined" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in globalThis &&
    globalThis.isSecureContext
  );
}

async function within<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timeout!);
  }
}

function registration(): Promise<ServiceWorkerRegistration> {
  return within(
    navigator.serviceWorker.ready,
    5000,
    "Notification service is not ready. Reload the app and try again.",
  );
}

function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const value = atob(
    key.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (key.length % 4)) % 4),
  );
  return Uint8Array.from(value, (c) => c.charCodeAt(0));
}

export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported()) return false;
  const existing = await navigator.serviceWorker.getRegistration();
  return !!(await existing?.pushManager.getSubscription());
}

export async function enablePush(): Promise<void> {
  const permission =
    Notification.permission === "granted" || Notification.permission === "denied"
      ? Notification.permission
      : await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Allow notifications in your browser settings.");
  const config = await request<{ application_server_key: string | null }>(
    "/notifications/push-key",
    { signal: AbortSignal.timeout(8000) },
  );
  if (!config.application_server_key)
    throw new Error("Push notifications are disabled on this server.");
  const worker = await registration();
  let subscription = await worker.pushManager.getSubscription();
  const desired = keyBytes(config.application_server_key);
  const old = subscription?.options.applicationServerKey;
  if (
    subscription &&
    old &&
    btoa(String.fromCharCode(...new Uint8Array(old)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "") !== config.application_server_key
  ) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await within(
    worker.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: desired,
    }),
    10000,
    "Browser push registration timed out. Try again.",
  );
  const value = subscription.toJSON();
  await request("/notifications/push-subscriptions", {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({ endpoint: value.endpoint, keys: value.keys }),
  });
}

export async function disablePush(): Promise<void> {
  const worker = await navigator.serviceWorker.getRegistration();
  const subscription = await worker?.pushManager.getSubscription();
  if (!subscription) return;
  await request("/notifications/push-subscriptions", {
    method: "DELETE",
    signal: AbortSignal.timeout(8000),
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
}
