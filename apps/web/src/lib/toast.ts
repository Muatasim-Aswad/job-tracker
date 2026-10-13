import { ApiError } from "@job-tracker/shared/api";

// Keep the store outside React so request/mutation handlers can publish toasts.

export type ToastKind = "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Snapshots change identity only with toasts, avoiding useSyncExternalStore loops.
export function getToasts(): Toast[] {
  return toasts;
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

// ttl of 0 keeps a toast until dismissed by hand.
function push(kind: ToastKind, message: string, ttl: number): number {
  const id = nextId++;
  toasts = [...toasts, { id, kind, message }];
  emit();
  if (ttl > 0) setTimeout(() => dismissToast(id), ttl);
  return id;
}

export const toast = {
  error: (message: string, ttl = 8000) => push("error", message, ttl),
  info: (message: string, ttl = 6000) => push("info", message, ttl),
};

export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const detail = err.message.trim();
    return detail ? `Request failed (${err.status}): ${detail}` : `Request failed (${err.status})`;
  }
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong.";
}
