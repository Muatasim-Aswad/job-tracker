import type {
  BridgeResponse,
  FormFillCaptureRequest,
  FormFillCaptureResponse,
  FormFillResolutionRequest,
  FormFillResolutionResponse,
} from "../messages.js";

export type ResolutionBridge = (
  request: FormFillResolutionRequest,
) => Promise<{ ok: true; result: FormFillResolutionResponse } | { ok: false }>;

export type CaptureBridge = (
  request: FormFillCaptureRequest,
) => Promise<{ ok: true; result: FormFillCaptureResponse } | { ok: false }>;

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

export const captureThroughWorker: CaptureBridge = (payload) =>
  new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: "form-fill-capture", payload },
        (response: BridgeResponse | undefined) => {
          if (chrome.runtime.lastError || !response?.ok) {
            resolve({ ok: false });
            return;
          }
          resolve({ ok: true, result: response.result as FormFillCaptureResponse });
        },
      );
    } catch {
      resolve({ ok: false });
    }
  });
