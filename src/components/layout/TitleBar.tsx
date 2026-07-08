import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import logo from "../../assets/sf-logo.png";

const appWindow = getCurrentWindow();

export function TitleBar() {
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
