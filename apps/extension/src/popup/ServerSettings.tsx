import { copy } from "./copy";
import { useState } from "react";
import { DEFAULT_SERVER_URL, SERVER_URL, normalizeServerUrl, connectServer } from "../config";
import { ICON } from "../icons";
import { ICON_BUTTON, PRIMARY_ICON_BUTTON, INPUT } from "./ui";

export function ServerSettings({ reachable }: { reachable: boolean }) {
  const [value, setValue] = useState(SERVER_URL);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setError("");
    try {
      const url = normalizeServerUrl(value);
      setBusy(true);
      await connectServer(url, true);
      setValue(url);
      setEditing(false);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : copy.serverSettings.couldNotConnectToTheServer,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 border-b border-popup-border-subtle pb-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-popup-fg">{copy.serverSettings.server}</span>
        <span
          role="img"
          aria-label={reachable ? copy.serverSettings.connected : copy.serverSettings.notConnected}
          title={reachable ? copy.serverSettings.connected : copy.serverSettings.notConnected}
          className={`size-1.5 shrink-0 rounded-full ${reachable ? "bg-popup-success" : "bg-popup-danger"}`}
        />
        <span className="min-w-0 flex-1 truncate text-xs text-popup-muted" title={SERVER_URL}>
          {new URL(SERVER_URL).host}
        </span>
        {!editing && (
          <button
            className={ICON_BUTTON}
            title={copy.serverSettings.changeServer}
            aria-label={copy.serverSettings.changeServer}
            onClick={() => setEditing(true)}
            dangerouslySetInnerHTML={{ __html: ICON.pencil }}
          />
        )}
      </div>
      {editing && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) void save();
          }}
        >
          <label htmlFor="server-url" className="sr-only">
            {copy.serverSettings.serverURL}
          </label>
          <input
            id="server-url"
            type="url"
            className={INPUT}
            value={value}
            disabled={busy}
            onChange={(event) => {
              setValue(event.target.value);
              setError("");
            }}
            spellCheck={false}
            autoComplete="off"
          />
          <div className="flex items-center justify-end gap-1.5" aria-busy={busy}>
            {busy && (
              <span role="status" className="mr-auto text-xs text-popup-muted">
                {copy.serverSettings.connecting}
              </span>
            )}
            {value !== DEFAULT_SERVER_URL && (
              <button
                type="button"
                className={`${ICON_BUTTON} mr-auto`}
                title={copy.serverSettings.restoreDefaultAddress}
                aria-label={copy.serverSettings.restoreDefaultAddress}
                disabled={busy}
                onClick={() => {
                  setValue(DEFAULT_SERVER_URL);
                  setError("");
                }}
                dangerouslySetInnerHTML={{ __html: ICON.rotateCcw }}
              />
            )}
            <button
              type="button"
              className={ICON_BUTTON}
              title={copy.serverSettings.cancelEditing}
              aria-label={copy.serverSettings.cancelEditing}
              disabled={busy}
              onClick={() => {
                setValue(SERVER_URL);
                setError("");
                setEditing(false);
              }}
              dangerouslySetInnerHTML={{ __html: ICON.x }}
            />
            <button
              type="submit"
              className={PRIMARY_ICON_BUTTON}
              title={copy.serverSettings.testAndSaveServer}
              aria-label={copy.serverSettings.testAndSaveServer}
              disabled={busy}
              dangerouslySetInnerHTML={{ __html: ICON.check }}
            />
          </div>
          {error && (
            <p role="alert" className="text-xs text-popup-danger">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
