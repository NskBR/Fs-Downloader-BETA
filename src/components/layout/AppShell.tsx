import {
  Archive,
  Download,
  FileText,
  Grid2X2,
  Menu,
  Music2,
  Settings,
  Video,
  X,
  ChevronDown,
  ChevronRight,
  Puzzle,
  Info,
  MoreHorizontal,
  BarChart3,
} from "lucide-react";
import { useEffect, useState, type PropsWithChildren } from "react";
import type { PageId } from "../../app/navigation";
import type { DownloadTask } from "../../domain/download";
import * as downloadService from "../../services/downloadService";
import { TitleBar } from "./TitleBar";
import { invoke } from "@tauri-apps/api/core";
import logo from "../../assets/sf-logo.png";

interface Props extends PropsWithChildren {
  activePage: PageId;
  onNavigate: (page: PageId) => void;
}

const groups = {
  documents: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv"],
  music: ["mp3", "wav", "flac", "ogg", "m4a", "aac"],
  videos: ["mp4", "mkv", "mov", "avi", "webm"],
  archives: ["zip", "rar", "7z", "tar", "gz"],
  applications: ["exe", "msi", "apk", "bat", "appimage", "dmg", "pkg"],
};

export function AppShell({
  activePage,
  onNavigate,
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [typesOpen, setTypesOpen] = useState(true);
  const [downloads, setDownloads] = useState<DownloadTask[]>([]);

  useEffect(() => {
    const update = () => {
      downloadService.listDownloads()
        .then(setDownloads)
        .catch(console.error);
    };
    update();
    const timer = setInterval(update, 2000);
    return () => clearInterval(timer);
  }, []);

  const navigate = (page: PageId) => {
    onNavigate(page);
    setOpen(false);
  };

  const openExternal = (url: string) => {
    void invoke("open_url", { url }).catch(console.error);
  };



  // Calculate dynamic counts
  const allCount = downloads.length;
  const archivesCount = downloads.filter(d => groups.archives.includes(d.extension?.toLowerCase() || "")).length;
  const documentsCount = downloads.filter(d => groups.documents.includes(d.extension?.toLowerCase() || "")).length;
  const videosCount = downloads.filter(d => groups.videos.includes(d.extension?.toLowerCase() || "")).length;
  const musicCount = downloads.filter(d => groups.music.includes(d.extension?.toLowerCase() || "")).length;
  const applicationsCount = downloads.filter(d => groups.applications.includes(d.extension?.toLowerCase() || "")).length;
  const othersCount = downloads.filter(d => {
    const ext = d.extension?.toLowerCase() || "";
    return !groups.archives.includes(ext) &&
           !groups.documents.includes(ext) &&
           !groups.videos.includes(ext) &&
           !groups.music.includes(ext) &&
           !groups.applications.includes(ext);
  }).length;

  const typeItems = [
    { id: "archives" as PageId, label: "Compactados", icon: Archive, count: archivesCount },
    { id: "documents" as PageId, label: "Documentos", icon: FileText, count: documentsCount },
    { id: "videos" as PageId, label: "Vídeos", icon: Video, count: videosCount },
    { id: "music" as PageId, label: "Músicas", icon: Music2, count: musicCount },
    { id: "applications" as PageId, label: "Programas", icon: Grid2X2, count: applicationsCount },
    { id: "calculator" as PageId, label: "Outros", icon: MoreHorizontal, count: othersCount },
  ];

  return (
    <div className="window-frame">
      <TitleBar />
      <div className="app-shell">
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
        <aside className={`sidebar ${open ? "sidebar--open" : ""}`}>
          <nav className="navigation sidebar-nav" aria-label="Navegação principal">
            <button
              className={`navigation__item ${activePage === "downloads" ? "navigation__item--active" : ""}`}
              onClick={() => navigate("downloads")}
            >
              <div>
                <Download />
                <span>Download</span>
              </div>
              <span className="counter-badge">{allCount}</span>
            </button>

            <button
              className="navigation__group"
              onClick={() => setTypesOpen((value) => !value)}
              aria-expanded={typesOpen}
            >
              <span className="navigation__group-label">
                {typesOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                Tipos de arquivo
              </span>
            </button>
            {typesOpen && typeItems.map((item) => {
              const isActive = activePage === item.id;
              return (
                <button
                  key={item.id}
                  className={`navigation__item navigation__item--child ${isActive ? "navigation__item--active" : ""}`}
                  onClick={() => navigate(item.id)}
                >
                  <div>
                    <item.icon />
                    <span>{item.label}</span>
                  </div>
                  <span className="counter-badge">{item.count}</span>
                </button>
              );
            })}
          </nav>
          
          <div className="sidebar-actions">
            <div className="sidebar-footer-row">
              <button
                className={`sidebar-footer-btn ${activePage === "settings" ? "active" : ""}`}
                onClick={() => navigate("settings")}
                title="Configurações"
              >
                <Settings size={18} />
              </button>

              <button
                className={`sidebar-footer-btn ${activePage === "metrics" ? "active" : ""}`}
                onClick={() => navigate("metrics")}
                title="Métricas"
              >
                <BarChart3 size={18} />
              </button>

              <button
                className="sidebar-footer-btn"
                onClick={() => setHelpOpen(true)}
                title="Sobre o aplicativo"
              >
                <Info size={18} />
              </button>
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
              <div className="help-brand">
                <img className="help-logo" src={logo} alt="SF Downloader" />
                <div>
                  <span>SF DOWNLOADER</span>
                  <h2>Sobre o Aplicativo</h2>
                </div>
              </div>
              <button onClick={() => setHelpOpen(false)} aria-label="Fechar">
                <X />
              </button>
            </header>

            <p className="help-intro">
              Gerenciador de downloads desktop moderno, feito para velocidade e
              organização. Conexões múltiplas, retomada, categorização automática
              e integração com o navegador.
            </p>

            <ul className="help-features">
              <li><Download size={15} /> Downloads segmentados e retomáveis</li>
              <li><Archive size={15} /> Extração automática de arquivos</li>
              <li><Grid2X2 size={15} /> Organização por categorias</li>
              <li><Puzzle size={15} /> Extensão para navegadores</li>
            </ul>

            <div className="help-meta">
              <div className="help-meta-row"><span>Versão</span><b>0.2.2</b></div>
              <div className="help-meta-row"><span>Tecnologia</span><b>Tauri · React · Rust</b></div>
              <div className="help-meta-row"><span>Licença</span><b>Uso pessoal</b></div>
            </div>

            <footer>
              <button
                className="help-link"
                onClick={() => openExternal("https://github.com/NskBR/Fs-Downloader-BETA")}
              >
                Repositório no GitHub
              </button>
              <button onClick={() => setHelpOpen(false)}>Fechar</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
