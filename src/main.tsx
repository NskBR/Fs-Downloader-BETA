import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { App } from "./app/App";
import { ConfirmationPage } from "./pages/ConfirmationPage";
import { ProgressPage } from "./pages/ProgressPage";
import { CompletePage } from "./pages/CompletePage";
import { loadSettings } from "./services/settingsStorage";
import "./styles/global.css";
import "./styles/scroll-fix.css";
import "./styles/settings-scale.css";
import "./styles/confirmation-redesign.css";
import "./styles/confirmation-xdm.css";
import "./styles/history-compact.css";
import "./styles/settings-standalone.css";
import "./styles/responsive.css";
import "./styles/xdm-windows.css";

const label = getCurrentWindow().label;
const isConfirmationWindow = label === "download-confirm";
const isProgressWindow = label.startsWith("download-progress-");
const isCompleteWindow = label.startsWith("download-complete-");

void getCurrentWebview().setZoom(loadSettings().uiScale).catch(console.error);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isConfirmationWindow ? <ConfirmationPage />
      : isProgressWindow ? <ProgressPage downloadId={label.substring("download-progress-".length)} />
      : isCompleteWindow ? <CompletePage downloadId={label.substring("download-complete-".length)} />
      : <App />}
  </React.StrictMode>,
);
