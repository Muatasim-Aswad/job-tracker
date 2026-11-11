import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../extension-settings/client";

// The most recently active dashboard supplies the shared scheduling time zone.
export function useNotificationTimeZone() {
  const client = useQueryClient();
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    const synchronize = async () => {
      if (document.visibilityState !== "visible" || busy) return;
      busy = true;
      try {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const current = await api.getExtensionSettings(controller.signal);
        if (
          controller.signal.aborted ||
          document.visibilityState !== "visible" ||
          current.settings.application_staleness.timezone === timezone
        )
          return;
        await api.updateExtensionSettings(
          {
            application_staleness: {
              ...current.settings.application_staleness,
              timezone,
            },
          },
          current.revision,
          controller.signal,
        );
        await client.invalidateQueries({ queryKey: ["extension-settings"] });
      } catch {
        // A disconnected or conflicting report retries on the next foreground visit.
      } finally {
        busy = false;
      }
    };
    void synchronize();
    window.addEventListener("focus", synchronize);
    document.addEventListener("visibilitychange", synchronize);
    return () => {
      controller.abort();
      window.removeEventListener("focus", synchronize);
      document.removeEventListener("visibilitychange", synchronize);
    };
  }, [client]);
}
