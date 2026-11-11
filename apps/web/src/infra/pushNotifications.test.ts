import { afterEach, expect, it, vi } from "vitest";
import { notificationTarget, receivePush } from "./pushNotifications";

const item = {
  id: "push-fixture",
  published_at: "2026-11-10T09:00:00+00:00",
  job_id: "job-fixture",
  title: "Follow up",
  body: null,
};
afterEach(() => vi.unstubAllGlobals());

it("shows and acknowledges one verified publication, then only reacknowledges retries", async () => {
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const fetch = vi
    .fn()
    .mockImplementation(async (_url, options) =>
      options?.method === "POST"
        ? new Response(null, { status: 204 })
        : Response.json({ ...item, state: "published" }),
    );
  vi.stubGlobal("fetch", fetch);
  const registration = { showNotification } as unknown as ServiceWorkerRegistration;
  await receivePush(registration, item);
  await receivePush(registration, item);
  expect(showNotification).toHaveBeenCalledOnce();
  expect(fetch.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(2);
  expect(fetch.mock.calls[1][0]).toBe("/api/notifications/push-fixture/ack");
});

it.each([
  { alert_suppressed_at: "muted" },
  { read_at: "read" },
  { resolved_at: "resolved" },
  { state: "cancelled" },
  { published_at: "obsolete" },
])("does not show a queued push after its current state changes: %j", async (patch) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ ...item, state: "published", ...patch })),
  );
  const showNotification = vi.fn();
  await receivePush({ showNotification } as unknown as ServiceWorkerRegistration, item);
  expect(showNotification).not.toHaveBeenCalled();
});

it("links job pushes to their drawer and general pushes to the inbox", () => {
  expect(notificationTarget(item, "https://tracker.example")).toBe(
    "https://tracker.example/?view=jobs&job=job-fixture",
  );
  expect(notificationTarget({ ...item, job_id: null }, "https://tracker.example")).toBe(
    "https://tracker.example/?view=jobs&notification=push-fixture",
  );
});
