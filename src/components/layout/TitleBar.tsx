import { Minus, Square, X, Sun, Moon, Monitor } from "lucide-react";
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
  const getThemeIcon = () => {
    if (theme === "light") {
      return <Sun size={15} />;
    } else {
      return <Moon size={15} />;
    }
  };

  const getThemeTitle = () => {
    if (theme === "light") {
      return "Tema: Claro (clique para alternar para Escuro)";
    } else {
      return "Tema: Escuro (clique para alternar para Claro)";
    }
  };

  const cycleTheme = () => {
    const next = theme === "light" ? "midnight" : "light";
    onThemeChange(next);
  };

  return (
    <header
      className="titlebar"
      data-tauri-drag-region
      onDoubleClick={() => void appWindow.toggleMaximize()}
    >
      <button
        className="titlebar-theme-btn"
        onClick={cycleTheme}
        title={getThemeTitle()}
        onDoubleClick={(event) => event.stopPropagation()}
        aria-label="Alterar tema"
      >
        {getThemeIcon()}
      </button>
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
