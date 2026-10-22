import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { toast } from "../lib/toast";
import { api } from "../api/client";
import { IconButton } from "../components/IconButton";
import { useFocusTrap, useScrollLock } from "../lib/useFocusTrap";
import { BUTTON } from "./model";
import { SettingsForm } from "./SettingsForm";

export function ExtensionSettingsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [editorTitle, setEditorTitle] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["extension-settings"],
    queryFn: api.getExtensionSettings,
    retry: false,
    gcTime: 0,
  });
  const mayDiscard = useCallback(
    () => !busy && !reloading && (!dirty || window.confirm("Discard unsaved extension settings?")),
    [dirty, busy, reloading],
  );
  const close = useCallback(() => {
    if (mayDiscard()) onClose();
  }, [mayDiscard, onClose]);
  useFocusTrap(ref, close);
  useScrollLock();
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const reload = async () => {
    if (!mayDiscard()) return;
    setReloading(true);
    const result = await query.refetch();
    setReloading(false);
    if (result.isSuccess) {
      setEditorTitle(null);
      toast.info("Settings reloaded.");
      setDirty(false);
      setGeneration((value) => value + 1);
    } else toast.error("Couldn’t reload settings. Check your connection and try again.");
  };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-overlay" onClick={close} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="extension-settings-title"
        tabIndex={-1}
        className="relative z-10 flex h-[min(90dvh,760px)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-line bg-canvas text-ink shadow-2xl outline-none"
      >
        <div className="shrink-0 border-b border-line px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <h2 id="extension-settings-title" className="text-sm font-semibold">
              {editorTitle ?? "Extension settings"}
            </h2>
            <IconButton
              label="Close extension settings"
              disabled={busy || reloading}
              onClick={close}
              className="text-ink-faint hover:text-ink"
            >
              <X size={16} />
            </IconButton>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            {editorTitle ? "Keyword actions" : "Shared with extensions connected to this server."}
          </p>
        </div>
        {query.data ? (
          <SettingsForm
            key={generation}
            initial={query.data}
            onSaved={(value) => client.setQueryData(["extension-settings"], value)}
            onDirtyChange={setDirty}
            onBusyChange={setBusy}
            onEditorChange={setEditorTitle}
            reloading={reloading}
            onReload={() => {
              void reload();
            }}
            onClose={close}
          />
        ) : (
          <div className="space-y-3 p-5 text-sm text-ink-muted">
            {query.isError ? (
              <>
                <p role="alert">
                  Couldn’t load extension settings. Check your connection and try again.
                </p>
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => {
                    void query.refetch();
                  }}
                  disabled={query.isFetching}
                >
                  Retry
                </button>
              </>
            ) : (
              <p role="status">Loading settings…</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
