import { afterEach, expect, it, vi } from "vitest";
import { enablePush, disablePush } from "./push";
import { request } from "../../infra/http";
vi.mock("../../infra/http", () => ({ request: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it.each(["default", "granted"] as const)(
  "registers push from a user action when browser permission is %s",
  async (permission) => {
    const requestPermission = vi.fn().mockResolvedValue("granted");
    vi.stubGlobal("Notification", { permission, requestPermission });
    const unsubscribe = vi.fn().mockResolvedValue(true);
    const subscription = {
      endpoint: "https://fcm.googleapis.com/test",
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/test",
        keys: { p256dh: "public", auth: "auth" },
      }),
      unsubscribe,
    };
    const subscribe = vi.fn().mockResolvedValue(subscription);
    const registration = {
      pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe },
    };
    vi.stubGlobal("navigator", {
      serviceWorker: {
        ready: Promise.resolve(registration),
        getRegistration: vi.fn().mockResolvedValue({
          pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) },
        }),
      },
    });
    vi.mocked(request)
      .mockResolvedValueOnce({ application_server_key: "BA" })
      .mockResolvedValue(undefined);
    await enablePush();
    expect(requestPermission).toHaveBeenCalledTimes(permission === "default" ? 1 : 0);
    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([4]),
    });
    expect(request).toHaveBeenCalledWith("/notifications/push-subscriptions", {
      method: "POST",
      signal: expect.any(AbortSignal),
      body: JSON.stringify(subscription.toJSON()),
    });
    await disablePush();
    expect(unsubscribe).toHaveBeenCalledOnce();
  },
);

it("explains blocked permission without attempting a subscription", async () => {
  const requestPermission = vi.fn().mockResolvedValue("denied");
  vi.stubGlobal("Notification", { permission: "denied", requestPermission });
  await expect(enablePush()).rejects.toThrow("Allow notifications in your browser settings.");
  expect(requestPermission).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

it("bounds a browser subscription that never completes", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("Notification", { permission: "granted" });
  vi.stubGlobal("navigator", {
    serviceWorker: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription: async () => null,
          subscribe: () => new Promise(() => {}),
        },
      }),
    },
  });
  vi.mocked(request).mockResolvedValue({ application_server_key: "BA" });
  const pending = enablePush();
  const rejected = expect(pending).rejects.toThrow(
    "Browser push registration timed out. Try again.",
  );
  await vi.advanceTimersByTimeAsync(10001);
  await rejected;
});
