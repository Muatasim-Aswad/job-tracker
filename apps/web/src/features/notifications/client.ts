import type {
  NotificationItem,
  NotificationPage,
  ReminderCreate,
  ReminderUpdate,
} from "@job-tracker/shared/api";
import { request, toQuery } from "../../infra/http";

export const api = {
  list: (filters: {
    job_id?: string;
    kind?: NotificationItem["kind"];
    state?: string;
    before?: string;
  }): Promise<NotificationPage> => request(`/notifications${toQuery(filters)}`),
  create: (body: ReminderCreate): Promise<NotificationItem> =>
    request("/notifications", { method: "POST", body: JSON.stringify(body) }),
  update: (id: string, body: ReminderUpdate): Promise<NotificationItem> =>
    request(`/notifications/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  cancel: (item: NotificationItem): Promise<NotificationItem> =>
    request(`/notifications/${item.id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ expected_revision: item.revision }),
    }),
  acknowledge: (item: NotificationItem): Promise<NotificationItem> =>
    request(`/notifications/${item.id}/ack`, {
      method: "POST",
      body: JSON.stringify({ published_at: item.published_at }),
    }),
  read: (item: NotificationItem): Promise<NotificationItem> =>
    request(`/notifications/${item.id}/read`, {
      method: "POST",
      body: JSON.stringify({ published_at: item.published_at }),
    }),
};
