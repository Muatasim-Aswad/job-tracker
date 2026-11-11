import type { NotificationItem } from "@job-tracker/shared/api";
import { toast } from "../../shared/toast";

import { presentOnce } from "../../infra/notificationReceipts";

export async function present(item: NotificationItem): Promise<void> {
  const key = `${item.id}:${item.published_at}`;
  await presentOnce(key, async () => {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        const registration =
          typeof navigator !== "undefined" && navigator.serviceWorker?.controller
            ? await navigator.serviceWorker.getRegistration()
            : null;
        if (registration && (await registration.pushManager.getSubscription())) {
          await registration.showNotification(item.title, {
            body: item.body ?? undefined,
            tag: key,
            icon: "/pwa-192.png",
            data: item,
          });
          return;
        }
        toast.info(item.title, 8000);
      } catch {
        toast.info(item.title, 8000);
      }
    } else toast.info(item.title, 8000);
  });
}

export function publication(value: unknown): NotificationItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<NotificationItem>;
  return typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.published_at === "string" &&
    item.state === "published"
    ? (item as NotificationItem)
    : null;
}
