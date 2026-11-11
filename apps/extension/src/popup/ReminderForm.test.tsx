import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ReminderForm, type ReminderHandle } from "./ReminderForm";
import { createReminder } from "./api";
vi.mock("./api", () => ({ createReminder: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("creates a reminder for the extension's current job using the shared submit action", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(createReminder).mockResolvedValue({} as never);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const ref = createRef<ReminderHandle>();
  const saved = vi.fn(),
    close = vi.fn(),
    error = vi.fn();
  try {
    await act(async () =>
      root.render(
        <ReminderForm
          ref={ref}
          jobId="extension-job"
          onSaved={saved}
          onClose={close}
          onError={error}
        />,
      ),
    );
    const inputs = container.querySelectorAll("input");
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
    await act(async () => {
      descriptor.set!.call(inputs[0], "Call recruiter");
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      descriptor.set!.call(inputs[1], "2030-11-10T14:30");
      inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => ref.current!.submit());
    expect(createReminder).toHaveBeenCalledWith({
      title: "Call recruiter",
      body: null,
      job_id: "extension-job",
      scheduled_at: new Date("2030-11-10T14:30").toISOString(),
    });
    expect(saved).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
