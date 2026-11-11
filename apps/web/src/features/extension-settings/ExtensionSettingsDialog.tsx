import { copy } from "./copy";
import { useCallback, useEffect, useRef, useState } from "react";
import { useExtensionSettings } from "./queries";
import { X } from "lucide-react";
import { toast } from "../../shared/toast";
import { IconButton } from "../../shared/ui/IconButton";
import { useFocusTrap, useScrollLock } from "../../shared/useFocusTrap";
import { BUTTON } from "./model";
import { SettingsForm } from "./SettingsForm";

export function ExtensionSettingsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [editorTitle, setEditorTitle] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const { query, saveCached } = useExtensionSettings();
  const mayDiscard = useCallback(
    () =>
      !busy &&
      !reloading &&
      (!dirty ||
        window.confirm(copy.extensionSettingsDialogMessages.discardUnsavedExtensionSettings)),
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
      toast.info(copy.extensionSettingsDialogMessages.settingsReloaded);
      setDirty(false);
      setGeneration((value) => value + 1);
    } else
      toast.error(
        copy.extensionSettingsDialogMessages.couldntReloadSettingsCheckYourConnectionAndTryAgain,
      );
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
              {editorTitle ?? copy.extensionSettingsDialogMessages.extensionSettings}
            </h2>
            <IconButton
              label={copy.extensionSettingsDialog.closeExtensionSettings}
              disabled={busy || reloading}
              onClick={close}
              className="text-ink-faint hover:text-ink"
            >
              <X size={16} />
            </IconButton>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            {editorTitle
              ? copy.extensionSettingsDialogMessages.keywordActions
              : copy.extensionSettingsDialogMessages.sharedWithExtensionsConnectedToThisServer}
          </p>
        </div>
        {query.data ? (
          <SettingsForm
            key={generation}
            initial={query.data}
            onSaved={saveCached}
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
                  {
                    copy.extensionSettingsDialog
                      .couldntLoadExtensionSettingsCheckYourConnectionAndTry
                  }
                </p>
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => {
                    void query.refetch();
                  }}
                  disabled={query.isFetching}
                >
                  {copy.extensionSettingsDialog.retry}
                </button>
              </>
            ) : (
              <p role="status">{copy.extensionSettingsDialog.loadingSettings}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
