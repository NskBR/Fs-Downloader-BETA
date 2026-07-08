import { Minus, Square, X, Puzzle } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import logo from "../../assets/sf-logo.png";

const appWindow = getCurrentWindow();

export function TitleBar() {
  const [extensionConnected, setExtensionConnected] = useState<boolean | null>(null);
  useEffect(() => {
    const updateStatus = () => {
      invoke<boolean>("browser_extension_status")
        .then(setExtensionConnected)
        .catch(() => setExtensionConnected(false));
    };
    updateStatus();
    const timer = setInterval(updateStatus, 3000);
    return () => clearInterval(timer);
  }, []);
  return (
    <header
      className="titlebar"
      data-tauri-drag-region
      onDoubleClick={() => void appWindow.toggleMaximize()}
    >
      <div className="titlebar-side" data-tauri-drag-region>
        <img className="titlebar-brand__logo" src={logo} alt="Logo" />
      </div>
      <div className="titlebar-center" data-tauri-drag-region>
        <strong>SF Downloader</strong>
      </div>
      <div className="titlebar-side titlebar-actions" data-tauri-drag-region>
        <div className="nodrag titlebar-integration">
          <button
            className="titlebar-theme-btn"
            onClick={() => void invoke("open_browser_integration_window").catch(console.error)}
            title={`Integração de Navegadores — ${extensionConnected ? "conectada" : "desconectada"}`}
          >
            <Puzzle size={16} />
            <span
              className={`sidebar-status-dot ${extensionConnected ? "connected" : "disconnected"}`}
              aria-hidden="true"
            />
          </button>
        </div>
        <div className="window-controls nodrag">
          <button
            aria-label="Minimizar"
            onClick={() => void appWindow.minimize()}
          >
            <Minus size={17} />
          </button>
          <button
            aria-label="Maximizar"
            onClick={() => void appWindow.toggleMaximize()}
          >
            <Square size={14} />
          </button>
          <button
            className="window-close"
            aria-label="Fechar"
            onClick={() => void appWindow.close()}
          >
            <X size={18} />
          </button>
        </div>
      </div>
    </header>
  );
}
