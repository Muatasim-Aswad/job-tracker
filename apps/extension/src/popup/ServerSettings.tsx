import { useEffect, useState } from "react";
import {
  DEFAULT_SERVER_URL,
  SERVER_URL,
  initializeServerConfig,
  normalizeServerUrl,
  connectServer,
} from "../config";
import { BUTTON, INPUT, PRIMARY_BUTTON } from "./ui";

export function ServerSettings() {
  const [value, setValue] = useState(SERVER_URL);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error: boolean } | null>(null);
  useEffect(() => {
    void initializeServerConfig().then(() => setValue(SERVER_URL));
  }, []);

  async function connect(save: boolean) {
    setFeedback(null);
    let url: string;
    try {
      url = normalizeServerUrl(value);
    } catch (error) {
      setFeedback({ text: (error as Error).message, error: true });
      return;
    }
    setBusy(true);
    try {
      // Chrome requires the permission request to originate directly in this click.
      await connectServer(url, save);
      setValue(url);
      setFeedback({ text: save ? "Server saved." : "Connected to Job Tracker.", error: false });
    } catch (error) {
      setFeedback({
        text: error instanceof Error ? error.message : "Could not connect to the server.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 border-b border-popup-border-subtle pb-3">
      <label htmlFor="server-url" className="text-[13px] text-popup-fg">
        Server URL
      </label>
      <input
        id="server-url"
        type="url"
        className={INPUT}
        value={value}
        disabled={busy}
        onChange={(event) => {
          setValue(event.target.value);
          setFeedback(null);
        }}
        spellCheck={false}
        autoComplete="off"
      />
      <div className="flex flex-wrap gap-2">
        <button className={BUTTON} disabled={busy} onClick={() => void connect(false)}>
          Test connection
        </button>
        <button className={PRIMARY_BUTTON} disabled={busy} onClick={() => void connect(true)}>
          {busy ? "Connecting…" : "Save server"}
        </button>
        <button
          className={BUTTON}
          disabled={busy || value === DEFAULT_SERVER_URL}
          onClick={() => {
            setValue(DEFAULT_SERVER_URL);
            setFeedback(null);
          }}
        >
          Use default
        </button>
      </div>
      {feedback && (
        <p
          role={feedback.error ? "alert" : "status"}
          className={`text-xs ${feedback.error ? "text-red-600 dark:text-red-400" : "text-popup-muted"}`}
        >
          {feedback.text}
        </p>
      )}
    </section>
  );
}
