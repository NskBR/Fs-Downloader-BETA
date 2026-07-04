import {
  Archive,
  ChevronDown,
  Download,
  FileText,
  Grid2X2,
  HelpCircle,
  Menu,
  Music2,
  Settings,
  Video,
  X,
} from "lucide-react";
import { useEffect, useState, type PropsWithChildren } from "react";
import type { PageId } from "../../app/navigation";
import type { AppTheme } from "../../domain/settings";
import { downloadCategories } from "../../domain/categories";
import * as downloadService from "../../services/downloadService";
import { TitleBar } from "./TitleBar";
import logo from "../../assets/sf-logo.png";

interface Props extends PropsWithChildren {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
}
const categories = [
  {
    key: "documents",
    label: "Documentos",
    icon: FileText,
    page: "documents" as PageId,
  },
  { key: "music", label: "Músicas", icon: Music2, page: "music" as PageId },
  { key: "videos", label: "Vídeos", icon: Video, page: "videos" as PageId },
  {
    key: "archives",
    label: "Compactados",
    icon: Archive,
    page: "archives" as PageId,
  },
  {
    key: "applications",
    label: "Aplicativos",
    icon: Grid2X2,
    page: "applications" as PageId,
  },
];

export function AppShell({
  activePage,
  onNavigate,
  theme,
  onThemeChange,
  children,
}: Props) {
  const [open, setOpen] = useState(false),
    [categoriesOpen, setCategoriesOpen] = useState(true),
    [helpOpen, setHelpOpen] = useState(false),
    [extension, setExtension] = useState<
      "checking" | "connected" | "disconnected"
    >("checking");
  useEffect(() => {
    const refresh = () =>
      void downloadService
        .browserExtensionConnected()
        .then((value) => setExtension(value ? "connected" : "disconnected"))
        .catch(() => setExtension("disconnected"));
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, []);
  const navigate = (page: PageId) => {
    onNavigate(page);
    setOpen(false);
  };
  return (
    <div className="window-frame">
      <TitleBar theme={theme} onThemeChange={onThemeChange} />
      <div className="app-shell redesigned-shell">
        <button
          className="mobile-menu"
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
        >
          <Menu size={21} />
        </button>
        {open && (
          <button
            className="sidebar-backdrop"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
          />
        )}
        <aside
          className={`sidebar redesigned-sidebar ${open ? "sidebar--open" : ""}`}
        >
          <button
            className="brand"
            title="SF Downloader"
            onClick={() => navigate("downloads")}
          >
            <img className="brand__logo" src={logo} alt="SF Downloader" />
          </button>
          <nav className="navigation" aria-label="Navegação principal">
            <button
              className={`navigation__item primary-nav ${activePage === "downloads" ? "navigation__item--active" : ""}`}
              onClick={() => navigate("downloads")}
            >
              <Download />
              <span>Downloads</span>
            </button>
            <button
              className="category-toggle"
              onClick={() => setCategoriesOpen((value) => !value)}
            >
              <ChevronDown className={categoriesOpen ? "open" : ""} />
              <span>Categorias</span>
            </button>
            {categoriesOpen && (
              <div className="category-navigation">
                {categories.map(({ key, label, icon: Icon, page }) => (
                  <button
                    key={key}
                    className={`navigation__item ${activePage === page ? "navigation__item--active" : ""}`}
                    onClick={() => navigate(page)}
                  >
                    <Icon />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </nav>
          <div className="sidebar-actions">
            <button className="settings-link" onClick={() => setHelpOpen(true)}>
              <HelpCircle />
              <span>Ajuda</span>
            </button>
            <button
              className={`settings-link ${activePage === "settings" ? "settings-link--active" : ""}`}
              onClick={() => navigate("settings")}
            >
              <Settings />
              <span>Configurações</span>
            </button>
            <div className={`sidebar-extension ${extension}`}>
              <i />
              <span>
                {extension === "connected"
                  ? "Extensão conectada"
                  : extension === "checking"
                    ? "Verificando extensão..."
                    : "Extensão desconectada"}
              </span>
            </div>
          </div>
        </aside>
        <main className="main-content">{children}</main>
      </div>
      {helpOpen && (
        <div className="help-overlay" onMouseDown={() => setHelpOpen(false)}>
          <section
            className="help-dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>ORGANIZAÇÃO AUTOMÁTICA</span>
                <h2>Ajuda sobre categorias</h2>
              </div>
              <button onClick={() => setHelpOpen(false)}>
                <X />
              </button>
            </header>
            <p>
              Quando a organização automática está ativa, cada arquivo é salvo
              na pasta correspondente ao seu formato.
            </p>
            <div className="help-category-list">
              {downloadCategories.map(
                ({ name, extensions, icon: Icon, color }) => (
                  <article key={name}>
                    <i style={{ color, background: `${color}18` }}>
                      <Icon />
                    </i>
                    <div>
                      <strong>{name}</strong>
                      <span>
                        {extensions.length
                          ? extensions.map((value) => `.${value}`).join(", ")
                          : "Formatos não classificados"}
                      </span>
                    </div>
                  </article>
                ),
              )}
            </div>
            <footer>
              <button onClick={() => setHelpOpen(false)}>Fechar</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
