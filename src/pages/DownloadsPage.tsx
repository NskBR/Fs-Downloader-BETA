import {
  AlertTriangle,
  FolderOpen,
  Pause,
  Play,
  Search,
  Trash2,
  X,
  Link2,
  CheckCircle2,
  XCircle,
  Clock,
  MoreVertical,
  FileText,
  List,
  LayoutGrid,
  ChevronDown,
  Activity,
  Zap,
  ArrowDown,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
} from "react";
import { useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppSettings } from "../domain/settings";
import type { PageId } from "../app/navigation";
import { useDownloads } from "../hooks/useDownloads";
import * as service from "../services/downloadService";
import type { DownloadTask } from "../domain/download";
import { CircularProgress } from "../components/downloads/CircularProgress";

const bytes = (value: number | null) => {
  if (value === null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value,
    index = 0;
  while (size >= 1024 && index < 4) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(index ? 1 : 0)} ${units[index]}`;
};

const sourceDomain = (value: string) => {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
};

const labels: Record<string, string> = {
  pending: "Preparando",
  checking_files: "Verificando arquivos",
  downloading: "Baixando",
  paused: "Pausado",
  assembling: "Montando arquivo",
  extracting: "Extraindo arquivo",
  completed: "Concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
};

const groups: Record<string, string[]> = {
  documents: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv"],
  music: ["mp3", "wav", "flac", "ogg", "m4a", "aac"],
  videos: ["mp4", "mkv", "mov", "avi", "webm"],
  archives: ["zip", "rar", "7z", "tar", "gz"],
  applications: ["exe", "msi", "apk", "bat", "appimage", "dmg", "pkg"],
};

type SortKey = "status" | "size" | "date";

export function DownloadsPage({
  settings,
  filter,
}: {
  settings: AppSettings;
  filter: PageId;
}) {
  const [search, setSearch] = useState("");
  const [starting, setStarting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastSelectedRef = useRef<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; item: DownloadTask } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<"list" | "grid">("list");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({
    key: "date",
    direction: "desc",
  });

  const { downloads, loading, error, setError, remove, cancel, pause, resume } =
    useDownloads(settings);

  const handleMenuAction = useCallback(
    (action: string, downloadId: string) => {
      const dl = downloads.find((d) => d.id === downloadId);
      switch (action) {
        case "pause": pause(downloadId); break;
        case "resume": resume(downloadId); break;
        case "cancel": cancel(downloadId); break;
        case "folder": if (dl) service.revealInFolder(dl.finalPath); break;
        case "open": if (dl) service.openFile(dl.finalPath); break;
        case "delete": if (window.confirm("Tem certeza que deseja excluir este download?")) remove([downloadId]); break;
      }
    },
    [downloads, pause, resume, cancel, remove],
  );

  useEffect(() => {
    const unlisten = listen<{ action: string; downloadId: string }>("context-menu-action", (event) => {
      handleMenuAction(event.payload.action, event.payload.downloadId);
    });
    return () => { void unlisten.then((fn) => fn()); };
  }, [handleMenuAction]);

  const handleContextMenu = (e: React.MouseEvent, item: DownloadTask) => {
    e.preventDefault();
    if (!selected.has(item.id)) {
      lastSelectedRef.current = item.id;
      setSelected(new Set([item.id]));
    }
    setCtxMenu({ x: e.clientX, y: e.clientY, item });
  };

  const runMenuAction = (action: string, item: DownloadTask) => {
    setCtxMenu(null);
    handleMenuAction(action, item.id);
  };

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCtxMenu(null); };
    window.addEventListener("mousedown", close);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  useEffect(() => {
    if (!ctxMenu || !ctxMenuRef.current) return;
    const el = ctxMenuRef.current;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let x = ctxMenu.x;
    let y = ctxMenu.y;
    if (x + rect.width + pad > window.innerWidth) x = window.innerWidth - rect.width - pad;
    if (y + rect.height + pad > window.innerHeight) y = window.innerHeight - rect.height - pad;
    el.style.left = `${Math.max(pad, x)}px`;
    el.style.top = `${Math.max(pad, y)}px`;
  }, [ctxMenu]);

  const inspect = async (raw: string) => {
    if (!raw.trim()) return;
    setStarting(true);
    setError(null);
    try {
      const token = crypto.randomUUID();
      localStorage.setItem(
        `sf-downloader.confirmation-${token}`,
        JSON.stringify({ url: raw.trim(), destination: settings.rootDownloadFolder }),
      );
      await service.openDownloadConfirmation(token);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    const receive = (event: Event) => {
      const value = (event as CustomEvent<string>).detail || localStorage.getItem("sf-downloader.pending-browser-url");
      if (!value) return;
      localStorage.removeItem("sf-downloader.pending-browser-url");
      void inspect(value);
    };
    window.addEventListener("sf-download-request", receive);
    const pending = localStorage.getItem("sf-downloader.pending-browser-url");
    if (pending) receive(new CustomEvent("sf-download-request", { detail: pending }));
    return () => window.removeEventListener("sf-download-request", receive);
  }, [settings.rootDownloadFolder]);

  const visible = downloads
    .filter((item) => {
      if (filter === "active" && !["pending", "checking_files", "downloading", "paused", "assembling", "extracting", "failed"].includes(item.status)) return false;
      if (filter === "completed" && item.status !== "completed") return false;
      if (filter === "calculator") {
        const allKnown = Object.values(groups).flat();
        if (allKnown.includes(item.extension?.toLowerCase() ?? "")) return false;
      } else {
        const extensions = groups[filter];
        if (extensions && !extensions.includes(item.extension?.toLowerCase() ?? "")) return false;
      }
      return item.fileName.toLowerCase().includes(search.toLowerCase());
    })
    .sort((a, b) => {
      const direction = sort.direction === "asc" ? 1 : -1;
      const statusOrder: Record<string, number> = {
        downloading: 0, assembling: 1, extracting: 2, paused: 3, pending: 4,
        checking_files: 5, failed: 6, cancelled: 7, completed: 8,
      };
      const values: Record<SortKey, [string | number, string | number]> = {
        status: [statusOrder[a.status] ?? 9, statusOrder[b.status] ?? 9],
        size: [a.fileSize ?? -1, b.fileSize ?? -1],
        date: [new Date(a.createdAt).getTime(), new Date(b.createdAt).getTime()],
      };
      const [left, right] = values[sort.key];
      return (left < right ? -1 : left > right ? 1 : 0) * direction;
    });

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: "status", label: "Status" },
    { key: "size", label: "Tamanho" },
    { key: "date", label: "Data" },
  ];

  const changeSort = (key: SortKey) => {
    setSort((current) => ({
      key,
      direction: current.key === key ? (current.direction === "asc" ? "desc" : "asc") : "desc",
    }));
  };

  const handleSelect = (id: string, event: React.MouseEvent) => {
    setSelected((value) => {
      if (event.shiftKey && lastSelectedRef.current) {
        const ids = visible.map((item) => item.id);
        const anchor = ids.indexOf(lastSelectedRef.current);
        const target = ids.indexOf(id);
        if (anchor !== -1 && target !== -1) {
          const [start, end] = anchor < target ? [anchor, target] : [target, anchor];
          const next = new Set(value);
          for (let i = start; i <= end; i++) next.add(ids[i]);
          return next;
        }
      }
      if (event.ctrlKey || event.metaKey) {
        const next = new Set(value);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        lastSelectedRef.current = id;
        return next;
      }
      lastSelectedRef.current = id;
      return new Set([id]);
    });
  };

  const openDetails = (id: string, status: string) => {
    if (status === "completed") service.openCompleteWindow(id);
    else service.openProgressWindow(id);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  const getCompletedElapsed = (item: DownloadTask) => {
    if (!item.createdAt || !item.completedAt) return "";
    const seconds = Math.max(0, Math.floor((new Date(item.completedAt).getTime() - new Date(item.createdAt).getTime()) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remSeconds = seconds % 60;
    return remSeconds === 0 ? `${minutes}min` : `${minutes}min ${remSeconds}s`;
  };

  const formatTimeRemaining = (item: DownloadTask) => {
    if (item.status !== "downloading" || !item.speedCurrent || !item.fileSize) return "";
    const remainingSeconds = Math.ceil((item.fileSize - item.totalDownloaded) / item.speedCurrent);
    if (remainingSeconds <= 0) return "calculando...";
    if (remainingSeconds < 60) return `${remainingSeconds}s restantes`;
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    if (minutes < 60) return `${minutes}m ${seconds}s restantes`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m restantes`;
  };

  const activeDownloads = downloads.filter((d) => d.status === "downloading");
  const totalSpeed = activeDownloads.reduce((sum, d) => sum + d.speedCurrent, 0);

  return (
    <>
      <header className="flux-header" data-tauri-drag-region>
        <div className="search-container" data-tauri-drag-region>
          <Search />
          <input
            className="search-input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                const value = search.trim();
                if (/^https?:\/\//i.test(value)) void inspect(value);
              }
            }}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text").trim();
              if (/^https?:\/\//i.test(text)) {
                event.preventDefault();
                void inspect(text);
              }
            }}
            placeholder="Buscar ou cole um link para baixar…"
          />
        </div>

        <div className="header-right-group" data-tauri-drag-region>
          <div className="sort-dropdown">
            <select
              className="sort-select"
              value={sort.key}
              onChange={(event) => changeSort(event.target.value as SortKey)}
              title="Ordenar por"
            >
              {sortOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="sort-direction"
              onClick={() => changeSort(sort.key)}
              title={sort.direction === "asc" ? "Crescente" : "Decrescente"}
            >
              <ArrowDown
                size={15}
                style={{ transform: sort.direction === "asc" ? "rotate(180deg)" : "none" }}
              />
            </button>
          </div>

          <button
            className={`btn-layout-switcher ${view === "list" ? "active" : ""}`}
            title="Visualização em Lista"
            onClick={() => setView("list")}
          >
            <List size={20} />
          </button>
          <button
            className={`btn-layout-switcher ${view === "grid" ? "active" : ""}`}
            title="Visualização em Grade"
            onClick={() => setView("grid")}
          >
            <LayoutGrid size={20} />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <section className="downloads-workspace">

        {/* Missing Folder Warning */}
        {!settings.rootDownloadFolder && (
          <div className="compact-notice">
            <AlertTriangle />
            <div>
              <strong>Defina uma pasta de destino nas Configurações</strong>
            </div>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="dismissible-banner" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>
              <X size={16} />
            </button>
          </div>
        )}

        {/* Scrollable list of Cards */}
        <div className={`cards-scroll-container view-${view}`}>
          {loading ? (
            <div style={{ textAlign: "center", color: "var(--muted)", padding: "40px" }}>Carregando...</div>
          ) : visible.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: "16px", color: "var(--muted)" }}>
              <FolderOpen size={48} />
              <strong>Nenhum download encontrado</strong>
            </div>
          ) : (
            visible.map((item) => {
              const progress = item.fileSize
                ? Math.min(100, (item.totalDownloaded / item.fileSize) * 100)
                : 0;

  const isCompleted = item.status === "completed";
  const isFailed = item.status === "failed" || item.status === "cancelled";
  const isWaiting = item.status === "pending" || item.status === "checking_files" || item.status === "assembling" || item.status === "extracting";
  const isPaused = item.status === "paused";
  const isDownloading = item.status === "downloading";

  const statusClass = isDownloading ? "downloading"
    : isPaused ? "paused"
    : isCompleted ? "completed"
    : isFailed ? "failed"
    : "waiting";
  const statusLabel = isDownloading ? "Baixando"
    : isPaused ? "Pausado"
    : isCompleted ? "Concluído"
    : isFailed ? (item.status === "cancelled" ? "Cancelado" : "Falhou")
    : "Na fila";

              return (
                <article
                  key={item.id}
                  className={`download-card status-${statusClass} ${selected.has(item.id) ? "selected" : ""}`}
                  onClick={(event) => handleSelect(item.id, event)}
                  onDoubleClick={() => openDetails(item.id, item.status)}
                  onContextMenu={(event) => handleContextMenu(event, item)}
                >
                  {/* Left Column: Status Indicator */}
                  <div className="card-indicator-col">
                    {(isDownloading || isPaused || isFailed) && progress > 0 ? (
                      <CircularProgress
                        value={progress}
                        color={`var(--st-${statusClass})`}
                      />
                    ) : isCompleted ? (
                      <div className="indicator-icon-wrapper success">
                        <CheckCircle2 />
                      </div>
                    ) : isFailed ? (
                      <div className="indicator-icon-wrapper error">
                        <XCircle />
                      </div>
                    ) : (
                      <div className="indicator-icon-wrapper waiting">
                        <Clock />
                      </div>
                    )}
                  </div>

                  {/* Center Column: Title, Info, Progress Bar */}
                  <div className="card-details-col">
                    <div className="card-title-row">
                      <h3 className="card-file-name" title={item.fileName}>
                        {item.fileName}
                      </h3>
                      <span className={`status-tag ${statusClass}`}>{statusLabel}</span>
                      <span className="card-date">{formatDate(item.createdAt)}</span>
                    </div>

                    {item.originalUrl && (
                      <button
                        type="button"
                        className="card-source"
                        title="Copiar link de origem"
                        onClick={(event) => {
                          event.stopPropagation();
                          void navigator.clipboard.writeText(item.originalUrl);
                        }}
                      >
                        <Link2 size={12} />
                        <span>{sourceDomain(item.originalUrl)}</span>
                      </button>
                    )}

                    <div className="card-info-row">
                      {isDownloading ? (
                        <>
                          <span className="meta-size">{bytes(item.totalDownloaded)} / {bytes(item.fileSize)}</span>
                          <span className="meta-sep" aria-hidden>·</span>
                          <span className="meta-speed">{bytes(item.speedCurrent)}/s</span>
                          <span className="meta-sep" aria-hidden>·</span>
                          <span className="meta-eta accent">{formatTimeRemaining(item)}</span>
                        </>
                      ) : isCompleted ? (
                        <>
                          <span className="meta-size">{bytes(item.fileSize)}</span>
                          <span className="meta-sep" aria-hidden>·</span>
                          <span className="meta-done">Concluído em {getCompletedElapsed(item)}</span>
                        </>
                      ) : isFailed ? (
                        <>
                          <span className="meta-status err">{item.status === "cancelled" ? "Cancelado" : "Falhou"}</span>
                          {item.fileSize && (
                            <>
                              <span className="meta-sep" aria-hidden>·</span>
                              <span className="meta-size">{bytes(item.totalDownloaded)} de {bytes(item.fileSize)}</span>
                            </>
                          )}
                        </>
                      ) : isPaused ? (
                        <>
                          <span className="meta-status paused">Pausado</span>
                          <span className="meta-sep" aria-hidden>·</span>
                          <span className="meta-size">{bytes(item.totalDownloaded)} de {bytes(item.fileSize)}</span>
                        </>
                      ) : (
                        <span className="meta-status">Na fila</span>
                      )}
                    </div>

                    {(isDownloading || isPaused) && (
                      <div className="card-progress-bar-track">
                        <div
                          className="card-progress-bar-fill"
                          style={{
                            width: `${progress}%`
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Right Column: Actions */}
                  <div className="card-actions-col">
                    {isCompleted && (
                      <button
                        className="card-action-btn"
                        title="Abrir pasta de destino"
                        onClick={(e) => {
                          e.stopPropagation();
                          service.revealInFolder(item.finalPath);
                        }}
                      >
                        <FolderOpen />
                      </button>
                    )}

                    {(isPaused || isFailed || isWaiting) && (
                      <button
                        className="card-action-btn"
                        title="Retomar download"
                        onClick={(e) => {
                          e.stopPropagation();
                          void resume(item.id);
                        }}
                      >
                        <Play />
                      </button>
                    )}

                    {isDownloading && (
                      <button
                        className="card-action-btn"
                        title="Pausar download"
                        onClick={(e) => {
                          e.stopPropagation();
                          void pause(item.id);
                        }}
                      >
                        <Pause />
                      </button>
                    )}

                    {!isCompleted && !isFailed && (
                      <button
                        className="card-action-btn"
                        title="Cancelar download"
                        onClick={(e) => {
                          e.stopPropagation();
                          void cancel(item.id);
                        }}
                      >
                        <X />
                      </button>
                    )}

                    {isFailed && (
                      <button
                        className="card-action-btn"
                        title="Excluir download"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm("Excluir este download permanentemente?")) {
                            remove([item.id]);
                          }
                        }}
                      >
                        <Trash2 />
                      </button>
                    )}

                    <button
                      className="card-action-btn menu-btn"
                      title="Opções"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleContextMenu(e, item);
                      }}
                    >
                      <MoreVertical />
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      {/* Discreete Footer */}
      <footer className="flux-footer">
        <div className="footer-left">
          <ArrowDown />
          <span><strong>{bytes(totalSpeed)}/s</strong> Velocidade atual</span>
        </div>

        <div className="footer-right">
          <Zap />
          <span>Downloads simultâneos: <strong>{activeDownloads.length}</strong></span>
          <ChevronDown size={14} style={{ marginLeft: "4px" }} />
        </div>
      </footer>

      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {ctxMenu.item.status === "downloading" && (
            <button className="ctx-item" onClick={() => runMenuAction("pause", ctxMenu.item)}>
              <Pause size={15} /> Pausar download
            </button>
          )}
          {["paused", "failed", "cancelled"].includes(ctxMenu.item.status) && (
            <button className="ctx-item" onClick={() => runMenuAction("resume", ctxMenu.item)}>
              <Play size={15} /> Retomar download
            </button>
          )}
          {["pending", "downloading", "paused"].includes(ctxMenu.item.status) && (
            <button className="ctx-item" onClick={() => runMenuAction("cancel", ctxMenu.item)}>
              <X size={15} /> Cancelar download
            </button>
          )}

          <div className="ctx-sep" />

          <button className="ctx-item" onClick={() => runMenuAction("folder", ctxMenu.item)}>
            <FolderOpen size={15} /> Abrir pasta de destino
          </button>
          {ctxMenu.item.status === "completed" && (
            <button className="ctx-item" onClick={() => runMenuAction("open", ctxMenu.item)}>
              <FileText size={15} /> Abrir arquivo
            </button>
          )}
          <button className="ctx-item ctx-item--danger" onClick={() => runMenuAction("delete", ctxMenu.item)}>
            <Trash2 size={15} /> Excluir download
          </button>
        </div>
      )}
    </>
  );
}
