import type {
  BridgeResponse,
  FormFillResolutionRequest,
  FormFillResolutionResponse,
} from "../messages.js";

export type ResolutionBridge = (
  request: FormFillResolutionRequest,
) => Promise<{ ok: true; result: FormFillResolutionResponse } | { ok: false }>;

export const resolveThroughWorker: ResolutionBridge = (payload) =>
  new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: "form-fill-resolve", payload },
        (response: BridgeResponse | undefined) => {
          if (chrome.runtime.lastError || !response?.ok) {
            resolve({ ok: false });
            return;
          }
          resolve({ ok: true, result: response.result as FormFillResolutionResponse });
        },
      );
    } catch {
      resolve({ ok: false });
    }
  });
