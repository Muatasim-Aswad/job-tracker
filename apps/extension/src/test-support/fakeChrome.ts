// Bridge fake-browser's promise event bus to the callback-style chrome API used by the engine.
import { vi } from "vitest";
import { fakeBrowser } from "@webext-core/fake-browser";

export function installFakeChrome() {
  fakeBrowser.reset();
  const sendMessage = vi.fn((message: unknown, callback?: (resp: unknown) => void) => {
    // Test listeners return their response; the required third argument is inert.
    const sendResponse = () => {};
    void fakeBrowser.runtime.onMessage
      .trigger(message, {} as never, sendResponse)
      .then((results) => {
        callback?.(results.find((r) => r !== undefined));
      });
  });
  const fakeChrome = {
    ...fakeBrowser,
    runtime: { ...fakeBrowser.runtime, sendMessage, lastError: undefined },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = fakeChrome;
  return { sendMessage, onMessage: fakeBrowser.runtime.onMessage };
}
