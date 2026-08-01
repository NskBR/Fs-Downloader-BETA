import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { App } from "./app/App";
import { ConfirmationPage } from "./pages/ConfirmationPage";
import { DownloadWindow } from "./pages/DownloadWindow";
import { TorrentConfirmationPage } from "./pages/TorrentConfirmationPage";
import { TorrentProgressWindow } from "./pages/TorrentProgressWindow";
import { BrowserIntegrationPage } from "./pages/BrowserIntegrationPage";
import { loadSettings } from "./services/settingsStorage";
import { applyThemeSettings } from "./services/theme";
import type { AppSettings } from "./domain/settings";
import "./styles/app.css";

const label = getCurrentWindow().label;
const torrentConfirmMatch = label.match(/^download-torrent-confirm-(.*)$/);
const confirmationMatch = label.match(/^download-confirm-(.*)$/);
const torrentProgressMatch = label.match(/^(?:torrent-progress-|download-torrent-live-)(.*)$/);
const isTorrentConfirmation = Boolean(torrentConfirmMatch);
const isConfirmationWindow = Boolean(confirmationMatch);
const isTorrentLiveWindow = Boolean(torrentProgressMatch);
const isLiveWindow = label.startsWith("download-") && !isConfirmationWindow && !isTorrentConfirmation && !isTorrentLiveWindow;
const isBrowserIntegrationWindow = label === "browser-integration";
const isMainWindow = label === "main";

if (isMainWindow) {
  document.documentElement.classList.add("window-type-main");
  document.body.classList.add("window-type-main");
} else if (isConfirmationWindow || isTorrentConfirmation) {
  document.documentElement.classList.add("window-type-confirmation");
  document.body.classList.add("window-type-confirmation");
} else if (isLiveWindow || isTorrentLiveWindow) {
  document.documentElement.classList.add("window-type-live");
  document.body.classList.add("window-type-live");
} else if (isBrowserIntegrationWindow) {
  document.documentElement.classList.add("window-type-integration");
  document.body.classList.add("window-type-integration");
}

const initialSettings = loadSettings();
applyThemeSettings(initialSettings);
void getCurrentWebview().setZoom(initialSettings.uiScale).catch(console.error);

void listen<AppSettings>("settings-changed", (event) => {
  if (event.payload) {
    applyThemeSettings(event.payload);
    void getCurrentWebview().setZoom(event.payload.uiScale).catch(console.error);
  }
});

window.addEventListener("storage", (event) => {
  if (event.key === "sf-downloader.settings.v1" && event.newValue) {
    try {
      const updated = JSON.parse(event.newValue);
      applyThemeSettings(updated);
      void getCurrentWebview().setZoom(updated.uiScale).catch(console.error);
    } catch {}
  }
});

if (label === "main" && !initialSettings.startInTrayMode) {
  void getCurrentWindow().show().catch(console.error);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isTorrentConfirmation ? (
      <TorrentConfirmationPage token={torrentConfirmMatch![1]} />
    ) : isConfirmationWindow ? (
      <ConfirmationPage token={confirmationMatch![1]} />
    ) : isTorrentLiveWindow ? (
      <TorrentProgressWindow downloadId={torrentProgressMatch![1]} />
    ) : isLiveWindow ? (
      <DownloadWindow downloadId={label.substring("download-".length)} />
    ) : isBrowserIntegrationWindow ? (
      <BrowserIntegrationPage />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);

if (label !== "main") {
  const reveal = () => void invoke("show_ready_window").catch(console.error);
  const fallback = window.setTimeout(reveal, 2000);
  requestAnimationFrame(() => requestAnimationFrame(async () => {
    await document.fonts?.ready;
    window.clearTimeout(fallback);
    reveal();
  }));
}
