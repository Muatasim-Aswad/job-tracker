import { initializeServerConfig, onServerChanged, SERVER_URL } from "../config.js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Popup } from "./Popup";
import { applyTheme, THEME_KEY, type Theme } from "./theme.js";
import "./popup.css";

// Apply the stored theme before mounting to avoid a flash. Extension CSP forbids
// an inline head script, so mount after async chrome.storage resolves.
function mount() {
  const root = createRoot(document.getElementById("root")!);
  const render = () =>
    root.render(
      <StrictMode>
        <Popup key={SERVER_URL} />
      </StrictMode>,
    );
  render();
  onServerChanged(render);
}

chrome.storage.local.get(THEME_KEY, (data) => {
  applyTheme((data[THEME_KEY] as Theme) || "system");
  void initializeServerConfig().then(mount);
});
