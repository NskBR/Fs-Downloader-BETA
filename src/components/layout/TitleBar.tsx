import { Minus, Square, X, Puzzle, Sparkles, ExternalLink } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { version } from "../../../package.json";
import type { UpdateCheckResult } from "../../services/downloadService";
import { openUrl } from "../../services/downloadService";

const appWindow = getCurrentWindow();

interface TitleBarProps {
  updateInfo?: UpdateCheckResult | null;
}

export function TitleBar({ updateInfo }: TitleBarProps) {
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

  const handleOpenRelease = () => {
    if (updateInfo?.release_url) {
      void openUrl(updateInfo.release_url);
    }
  };

  return (
    <header
      className="titlebar"
      data-tauri-drag-region
      onDoubleClick={() => void appWindow.toggleMaximize()}
    >
      <div className="titlebar-side" data-tauri-drag-region>
        {updateInfo?.available && (
          <button
            className="nodrag titlebar-update-badge"
            onClick={handleOpenRelease}
            title={`Nova versão v${updateInfo.latest_version} disponível! Clique para abrir no GitHub.`}
          >
            <Sparkles size={12} className="icon-pulse" />
            <span>Nova versão disponível</span>
            <ExternalLink size={11} />
          </button>
        )}
      </div>
      <div className="titlebar-center" data-tauri-drag-region>
        <strong>SFDownloader</strong>
        <span className="titlebar-version">v{version}</span>
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
