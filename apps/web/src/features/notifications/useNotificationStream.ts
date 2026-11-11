import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { present, publication } from "./delivery";
import { NOTIFICATIONS_KEY } from "./queries";

export function useNotificationStream() {
  const client = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource("/api/notifications/stream");
    const refresh = () => {
      void client.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
      void client.invalidateQueries({ queryKey: ["jobs"] });
      void client.invalidateQueries({ queryKey: ["job"] });
      void client.invalidateQueries({ queryKey: ["extension-settings"] });
    };
    source.addEventListener("sync", refresh);
    source.addEventListener("notification", (event: MessageEvent<string>) => {
      try {
        const item = publication(JSON.parse(event.data));
        if (!item || item.read_at || item.resolved_at || item.alert_suppressed_at) return;
        void present(item)
          .then(() => api.acknowledge(item))
          .catch(() => {
            /* The worker retries until acknowledged. */
          });
        refresh();
      } catch {
        /* An invalid message cannot acknowledge or present a notification. */
      }
    });
    return () => source.close();
  }, [client]);
}
