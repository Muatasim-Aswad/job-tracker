import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NotificationItem } from "@job-tracker/shared/api";
vi.mock("./useNotificationTimeZone", () => ({ useNotificationTimeZone: vi.fn() }));

import { NotificationCard } from "./NotificationCard";
import { JobReminders } from "./JobReminders";
import { ReminderForm } from "./ReminderForm";
import { NotificationBell } from "./NotificationBell";
import { useNotificationStream } from "./useNotificationStream";
import { api } from "./client";
import { enablePush, disablePush, pushEnabled, pushSupported } from "./push";
import { BrowserNotificationSettings } from "./BrowserNotificationSettings";
import { stubStorage } from "../../test/storage";
import { toast } from "../../shared/toast";

vi.mock("./client", () => ({
  api: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
    read: vi.fn(),
    acknowledge: vi.fn(),
  },
}));

vi.mock("./push", () => ({
  enablePush: vi.fn(),
  disablePush: vi.fn(),
  pushEnabled: vi.fn(),
  pushSupported: vi.fn(),
}));

class Source extends EventTarget {
  static current: Source;
  close = vi.fn();
  url: string;
  constructor(url: string) {
    super();
    this.url = url;
    Source.current = this;
  }
  emit(event: string, data: unknown) {
    this.dispatchEvent(new MessageEvent(event, { data: JSON.stringify(data) }));
  }
}

const item: NotificationItem = {
  id: "notification-fixture",
  kind: "manual_reminder",
  job_id: null,
  title: "Follow up",
  body: null,
  scheduled_at: "2026-11-10T12:00:00+00:00",
  published_at: "2026-11-10T12:00:01+00:00",
  state: "published",
  delivered_at: null,
  alert_suppressed_at: null,
  read_at: null,
  resolved_at: null,
  revision: "one",
  created_at: "2026-11-09T12:00:00+00:00",
  updated_at: "2026-11-10T12:00:01+00:00",
};

beforeEach(() => {
  vi.clearAllMocks();
  stubStorage();
  vi.mocked(pushSupported).mockReturnValue(true);
  vi.mocked(pushEnabled).mockResolvedValue(false);
  vi.mocked(enablePush).mockResolvedValue(undefined);
  vi.mocked(disablePush).mockResolvedValue(undefined);
  vi.stubGlobal("EventSource", Source);
  vi.stubGlobal("Notification", { permission: "default" });
  vi.mocked(api.list).mockResolvedValue({ items: [], next_cursor: null, unread_count: 0 });
  vi.mocked(api.acknowledge).mockResolvedValue(item);
  vi.mocked(api.create).mockResolvedValue(item);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

it("saves a job reminder with UTC time and its preselected job", async () => {
  render(
    <JobReminders jobId="job-fixture" disclosure={{ collapsed: false, onToggle: vi.fn() }} />,
    { wrapper: wrapper() },
  );
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  expect(
    screen.queryByText("No scheduled reminders. Add one to remember your next step."),
  ).toBeNull();
  expect(screen.getByRole("button", { name: "About Reminders" })).toBeTruthy();
  expect(api.list).toHaveBeenCalledWith({
    state: "scheduled",
    job_id: "job-fixture",
    kind: "manual_reminder",
    before: undefined,
  });
  fireEvent.click(screen.getByRole("button", { name: "Add reminder" }));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Call recruiter" } });
  fireEvent.change(screen.getByLabelText("Date and time"), {
    target: { value: "2030-11-10T14:30" },
  });
  fireEvent.change(screen.getByLabelText("Details (optional)"), {
    target: { value: "Ask about interviews" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save reminder" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add reminder" })).toBeNull());
  expect(api.create).toHaveBeenCalledWith({
    title: "Call recruiter",
    body: "Ask about interviews",
    job_id: "job-fixture",
    scheduled_at: new Date("2030-11-10T14:30").toISOString(),
  });
});

it("fetches an unread inbox without presenting or acknowledging a popup", async () => {
  const info = vi.spyOn(toast, "info");
  const openJob = vi.fn();
  vi.mocked(api.list).mockResolvedValue({
    items: [{ ...item, job_id: "linked-job" }],
    next_cursor: null,
    unread_count: 1,
  });
  render(<NotificationBell onOpenJob={openJob} />, { wrapper: wrapper() });
  fireEvent.click(await screen.findByRole("button", { name: "1 unread notification" }));
  expect(await screen.findByText("Follow up")).toBeTruthy();
  expect(info).not.toHaveBeenCalled();
  expect(api.acknowledge).not.toHaveBeenCalled();
  const link = screen.getByRole("link", { name: "Follow up" });
  expect(link.getAttribute("href")).toBe("/?view=jobs&job=linked-job");
  fireEvent.click(link);
  expect(openJob).toHaveBeenCalledWith("linked-job");
  expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull();
});

it("presents an unacknowledged publication once, reacks retries, and presents a new cycle", async () => {
  function Connected() {
    useNotificationStream();
    return null;
  }
  // No native notifications in this environment: successful handling uses the toast.
  delete (window as unknown as Record<string, unknown>).Notification;
  const info = vi.spyOn(toast, "info");
  render(<Connected />, { wrapper: wrapper() });
  act(() => {
    Source.current.emit("sync", {});
  });
  expect(info).not.toHaveBeenCalled();
  act(() => {
    Source.current.emit("notification", item);
  });
  await waitFor(() => expect(api.acknowledge).toHaveBeenCalledTimes(1));
  act(() => {
    Source.current.emit("notification", item);
  });
  await waitFor(() => expect(api.acknowledge).toHaveBeenCalledTimes(2));
  expect(info).toHaveBeenCalledTimes(1);
  act(() => {
    Source.current.emit("notification", { ...item, published_at: "2026-12-01T12:00:00+00:00" });
  });
  await waitFor(() => expect(info).toHaveBeenCalledTimes(2));
  cleanup();
  expect(Source.current.close).toHaveBeenCalledOnce();
});

it("nested reminder Escape closes only the reminder and protects its dirty draft", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<NotificationBell onOpenJob={vi.fn()} />, { wrapper: wrapper() });
  fireEvent.click(screen.getByRole("button", { name: "Open notifications" }));
  fireEvent.click(screen.getByRole("button", { name: "Add reminder" }));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Draft" } });
  fireEvent.keyDown(window, { key: "Escape" });
  expect(confirm).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog", { name: "Add reminder" })).toBeNull();
  expect(screen.getByRole("dialog", { name: "Notifications" })).toBeTruthy();
});

it("keeps the inbox action icon-only and permission status in Settings", async () => {
  vi.stubGlobal("Notification", { permission: "granted" });
  render(<NotificationBell onOpenJob={vi.fn()} />, { wrapper: wrapper() });
  fireEvent.click(screen.getByRole("button", { name: "Open notifications" }));
  const add = screen.getByRole("button", { name: "Add reminder" });
  expect(add.textContent).toBe("");
  expect(add.title).toBe("Add reminder");
  expect(screen.queryByText("Notifications are allowed in this browser.")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Scheduled" }));
  await waitFor(() =>
    expect(api.list).toHaveBeenCalledWith({
      state: "scheduled",
      kind: "manual_reminder",
      job_id: undefined,
      before: undefined,
    }),
  );
  cleanup();
  vi.mocked(pushEnabled).mockResolvedValue(true);
  render(<BrowserNotificationSettings disabled={false} />);
  expect(await screen.findByRole("button", { name: "Turn off" })).toBeTruthy();
});

it("enables browser notifications explicitly without submitting settings", async () => {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  render(
    <form onSubmit={submit}>
      <BrowserNotificationSettings disabled={false} />
    </form>,
  );
  await waitFor(() =>
    expect((screen.getByRole("button", { name: "Allow" }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  expect(enablePush).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Allow" }));
  await screen.findByRole("button", { name: "Turn off" });
  expect(enablePush).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
  await screen.findByRole("button", { name: "Allow" });
  expect(disablePush).toHaveBeenCalledOnce();
});

it("general reminder creation explains linking through the drawer", () => {
  render(<ReminderForm onClose={vi.fn()} />, { wrapper: wrapper() });
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.getByText(/For a job-linked reminder/)).toBeTruthy();
});

it("keeps card actions independent of job navigation and leaves unlinked cards unlinked", () => {
  const edit = vi.fn(),
    cancel = vi.fn(),
    open = vi.fn();
  const { rerender } = render(
    <NotificationCard
      item={{ ...item, state: "scheduled", job_id: "linked-job" }}
      busy={false}
      onRead={vi.fn()}
      onEdit={edit}
      onCancel={cancel}
      onOpenJob={open}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit reminder" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel reminder" }));
  expect(edit).toHaveBeenCalledOnce();
  expect(cancel).toHaveBeenCalledOnce();
  expect(open).not.toHaveBeenCalled();
  rerender(
    <NotificationCard item={item} busy={false} onRead={vi.fn()} onEdit={edit} onCancel={cancel} />,
  );
  expect(screen.queryByRole("link")).toBeNull();
});
