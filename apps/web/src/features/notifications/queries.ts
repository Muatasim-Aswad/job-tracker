import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { NotificationItem, ReminderCreate, ReminderUpdate } from "@job-tracker/shared/api";
import { api } from "./client";

export const NOTIFICATIONS_KEY = ["notifications"] as const;

export function useNotifications(
  state: "scheduled" | "published",
  jobId?: string,
  kind?: NotificationItem["kind"],
) {
  return useInfiniteQuery({
    queryKey: [...NOTIFICATIONS_KEY, state, jobId ?? null, kind ?? null],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.list({ state, job_id: jobId, kind, before: pageParam }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
}

export function useNotificationActions() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
  const create = useMutation({
    mutationFn: (body: ReminderCreate) => api.create(body),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReminderUpdate }) => api.update(id, body),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: (item: NotificationItem) => api.cancel(item),
    onSuccess: refresh,
  });
  const read = useMutation({
    mutationFn: (item: NotificationItem) => api.read(item),
    onSuccess: refresh,
  });
  return { create, update, cancel, read };
}
