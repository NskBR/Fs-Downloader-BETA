import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AppTheme } from "../../domain/settings";

const appWindow = getCurrentWindow();

export function TitleBar({
  theme,
  onThemeChange,
}: {
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
}) {
  return (
    <header
      className="titlebar"
      data-tauri-drag-region
      onDoubleClick={() => void appWindow.toggleMaximize()}
    >
      <label
        className="titlebar-theme"
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <span>Tema:</span>
        <select
          value={theme}
          onChange={(event) => onThemeChange(event.target.value as AppTheme)}
        >
          <option value="system">Sistema</option>
          <option value="light">Claro</option>
          <option value="midnight">Escuro</option>
        </select>
      </label>
      <div className="window-controls">
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
    </header>
  );
}
