import {
  AlertTriangle,
  Ban,
  CheckSquare,
  ExternalLink,
  FolderOpen,
  Link2,
  Pause,
  Play,
  Plus,
  Search,
  Square,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { FileIcon } from "../components/downloads/FileIcon";
import type { AppSettings } from "../domain/settings";
import type { PageId } from "../app/navigation";
import { useDownloads } from "../hooks/useDownloads";
import * as service from "../services/downloadService";
import type { DownloadTask } from "../domain/download";

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
const groups: Partial<Record<PageId, string[]>> = {
  documents: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv"],
  music: ["mp3", "wav", "flac", "ogg", "m4a", "aac"],
  videos: ["mp4", "mkv", "mov", "avi", "webm"],
  archives: ["zip", "rar", "7z", "tar", "gz"],
  applications: ["exe", "msi", "apk", "bat", "appimage", "dmg", "pkg"],
};
type SortKey = "name" | "size" | "date" | "status";

export function DownloadsPage({
  settings,
  filter,
}: {
  settings: AppSettings;
  filter: PageId;
}) {
  const [url, setUrl] = useState("");
  const [search, setSearch] = useState("");
  const [starting, setStarting] = useState(false);
  const [composer, setComposer] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>(
    { key: "date", direction: "desc" },
  );
  const [columns, setColumns] = useState<number[]>(() => {
    try {
      return JSON.parse(
        localStorage.getItem("sf-downloader.columns-v4") || "[110,100]",
      );
    } catch {
      return [110, 100];
    }
  });
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    downloadId: string;
    status: string;
    filePath: string;
  } | null>(null);

  const { downloads, loading, error, setError, remove, cancel, pause, resume } =
    useDownloads(settings);
  const drag = useRef<{ index: number; x: number; width: number } | null>(null);

  const [colOrder, setColOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("sf-downloader.column-order-v4");
      return saved ? JSON.parse(saved) : ["name", "status", "size", "date"];
    } catch {
      return ["name", "status", "size", "date"];
    }
  });

  useEffect(() => {
    localStorage.setItem("sf-downloader.column-order-v4", JSON.stringify(colOrder));
  }, [colOrder]);

  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIdx(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === targetIdx) return;
    const nextOrder = [...colOrder];
    const [moved] = nextOrder.splice(draggedIdx, 1);
    nextOrder.splice(targetIdx, 0, moved);
    setColOrder(nextOrder);
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
  };

  const getColWidth = (col: string) => {
    if (col === "name") return "minmax(150px, 1fr)";
    if (col === "date") return "var(--date-width)";
    if (col === "size") return "var(--size-width)";
    if (col === "status") return "82px";
    return "";
  };

  const tableGridStyle = {
    gridTemplateColumns: `25px 38px ${colOrder.map(getColWidth).join(" ")}`,
    "--date-width": `${columns[0]}px`,
    "--size-width": `${columns[1]}px`,
  } as CSSProperties;

  const inspect = async (raw: string) => {
    if (!raw.trim()) return;
    setStarting(true);
    setError(null);
    try {
      localStorage.setItem(
        "sf-downloader.confirmation",
        JSON.stringify({
          url: raw.trim(),
          destination: settings.rootDownloadFolder,
        }),
      );
      await service.openDownloadConfirmation();
      setUrl("");
      setComposer(false);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setStarting(false);
    }
  };

  useEffect(() => {
    const receive = (event: Event) => {
      const value =
        (event as CustomEvent<string>).detail ||
        localStorage.getItem("sf-downloader.pending-browser-url");
      if (!value) return;
      localStorage.removeItem("sf-downloader.pending-browser-url");
      void inspect(value);
    };
    window.addEventListener("sf-download-request", receive);
    const pending = localStorage.getItem("sf-downloader.pending-browser-url");
    if (pending)
      receive(new CustomEvent("sf-download-request", { detail: pending }));
    return () => window.removeEventListener("sf-download-request", receive);
  }, [settings.rootDownloadFolder]);
  useEffect(() => {
    localStorage.setItem("sf-downloader.columns-v4", JSON.stringify(columns));
  }, [columns]);

  useEffect(() => {
    const move = (event: MouseEvent) => {
      const current = drag.current;
      if (!current) return;
      setColumns((old) =>
        old.map((value, index) =>
          index === current.index
            ? Math.min(
                index === 0 ? 250 : 180,
                Math.max(
                  index === 0 ? 90 : 75,
                  current.width + event.clientX - current.x,
                ),
              )
            : value,
        ),
      );
    };
    const up = () => (drag.current = null);
    addEventListener("mousemove", move);
    addEventListener("mouseup", up);
    return () => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", up);
    };
  }, []);

  // Fechar o menu de contexto ao clicar em qualquer lugar
  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  const handleContextMenu = (e: React.MouseEvent, item: DownloadTask) => {
    e.preventDefault();
    const menuHeight = 220;
    const menuWidth = 180;
    
    let y = e.clientY;
    let x = e.clientX;
    
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 10;
      if (y < 0) y = 0;
    }
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 10;
      if (x < 0) x = 0;
    }

    setContextMenu({
      x,
      y,
      downloadId: item.id,
      status: item.status,
      filePath: item.finalPath,
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void inspect(url);
  };

  const replaceLink = async (id: string) => {
    const value = prompt("Cole a nova URL para este arquivo:");
    if (!value) return;
    setError(null);
    try {
      await service.replaceDownloadUrl(id, value.trim());
      await resume(id);
    } catch (cause) {
      setError(String(cause));
    }
  };

  const visible = downloads
    .filter((item) => {
      if (
        filter === "active" &&
        ![
          "pending",
          "checking_files",
          "downloading",
          "paused",
          "assembling",
          "extracting",
          "failed",
        ].includes(item.status)
      )
        return false;
      if (filter === "completed" && item.status !== "completed") return false;
      const extensions = groups[filter];
      if (
        extensions &&
        !extensions.includes(item.extension?.toLowerCase() ?? "")
      )
        return false;
      return item.fileName.toLowerCase().includes(search.toLowerCase());
    })
    .sort((a, b) => {
      const direction = sort.direction === "asc" ? 1 : -1;
      const values: Record<SortKey, [string | number, string | number]> = {
        name: [a.fileName.toLowerCase(), b.fileName.toLowerCase()],
        size: [a.fileSize ?? -1, b.fileSize ?? -1],
        date: [
          new Date(a.createdAt).getTime(),
          new Date(b.createdAt).getTime(),
        ],
        status: [a.status, b.status],
      };
      const [left, right] = values[sort.key];
      return (left < right ? -1 : left > right ? 1 : 0) * direction;
    });
  const changeSort = (key: SortKey) =>
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  const heading = (key: SortKey, label: string) => (
    <button
      className={`sort-heading ${sort.key === key ? "active" : ""}`}
      onClick={() => changeSort(key)}
    >
      {label}
      <span>
        {sort.key === key ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );

  const toggle = (id: string) =>
    setSelected((value) => {
      const next = new Set(value);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const picked = downloads.filter((item) => selected.has(item.id));

  const resumableStates = ["paused", "failed", "cancelled"];
  const cancelableStates = ["pending", "downloading", "paused"];

  const canPause = picked.some((item) => item.status === "downloading");
  const canResume = picked.some((item) => resumableStates.includes(item.status));
  const canCancel = picked.some((item) => cancelableStates.includes(item.status));

  const handlePauseSelected = () => {
    picked.forEach((item) => {
      if (item.status === "downloading") void pause(item.id);
    });
  };

  const handleResumeSelected = () => {
    picked.forEach((item) => {
      if (resumableStates.includes(item.status)) void resume(item.id);
    });
  };

  const handleCancelSelected = () => {
    picked.forEach((item) => {
      if (cancelableStates.includes(item.status)) void cancel(item.id);
    });
  };

  const openDetails = (event: React.MouseEvent) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>(
      ".reference-row",
    );
    if (!row) return;
    const index = [
      ...row.parentElement!.querySelectorAll(".reference-row"),
    ].indexOf(row);
    const item = visible[index];
    if (item) void service.openProgressWindow(item.id);
  };

  return (
    <section className="downloads-workspace" onDoubleClick={openDetails}>
      <div className="reference-toolbar">
        <button
          className="new-download-button"
          onClick={() => setComposer((value) => !value)}
        >
          <Plus />
          Novo
        </button>
        <button
          className="toolbar-action"
          disabled={!canPause}
          onClick={handlePauseSelected}
        >
          <Pause />
          Pausar
        </button>
        <button
          className="toolbar-action"
          disabled={!canResume}
          onClick={handleResumeSelected}
        >
          <Play />
          Resumir
        </button>
        <button
          className="toolbar-action"
          disabled={!canCancel}
          onClick={handleCancelSelected}
        >
          <Ban />
          Cancelar
        </button>
        <i className="toolbar-divider" />
        <label className="toolbar-search">
          <Search />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar"
          />
        </label>
      </div>
      {composer && (
        <form className="url-composer" onSubmit={submit}>
          <input
            type="url"
            required
            autoFocus
            placeholder="Cole a URL do arquivo"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <button
            className="new-download-button"
            disabled={starting || !settings.rootDownloadFolder}
          >
            {starting ? "Analisando..." : "Continuar"}
          </button>
        </form>
      )}
      {!settings.rootDownloadFolder && (
        <div className="notice compact-notice">
          <AlertTriangle />
          <div>
            <strong>Defina uma pasta nas configurações</strong>
          </div>
        </div>
      )}
      {error && <div className="error-banner">{error}</div>}
      <div className="reference-table" style={tableGridStyle}>
        <div className="table-head" style={tableGridStyle}>
          <span />
          <span />
          {colOrder.map((col, idx) => {
            if (col === "name") return (
              <span
                key="name"
                className="col-name"
                draggable
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, idx)}
                onDragEnd={handleDragEnd}
              >
                {heading("name", "Nome")}
              </span>
            );
            if (col === "date") return (
              <span
                key="date"
                className="resizable col-date"
                draggable
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, idx)}
                onDragEnd={handleDragEnd}
              >
                {heading("date", "Data")}
                <i
                  onMouseDown={(event) =>
                    (drag.current = {
                      index: 0,
                      x: event.clientX,
                      width: columns[0],
                    })
                  }
                />
              </span>
            );
            if (col === "size") return (
              <span
                key="size"
                className="resizable col-size"
                draggable
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, idx)}
                onDragEnd={handleDragEnd}
              >
                {heading("size", "Tamanho")}
                <i
                  onMouseDown={(event) =>
                    (drag.current = {
                      index: 1,
                      x: event.clientX,
                      width: columns[1],
                    })
                  }
                />
              </span>
            );
            if (col === "status") return (
              <span
                key="status"
                className="col-status"
                draggable
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, idx)}
                onDragEnd={handleDragEnd}
              >
                {heading("status", "Status")}
              </span>
            );
            return null;
          })}
        </div>
        <div className="download-list">
          {loading ? (
            <div className="empty-compact">Carregando...</div>
          ) : visible.length === 0 ? (
            <div className="empty-compact">
              <FolderOpen />
              <strong>Nenhum arquivo</strong>
              <span>Use Novo para adicionar uma URL.</span>
            </div>
          ) : (
            visible.map((item) => {
              const progress = item.fileSize
                ? Math.min(100, (item.totalDownloaded / item.fileSize) * 100)
                : 0;
              const resumable = ["paused", "failed", "cancelled"].includes(
                item.status,
              );
              return (
                <article
                  className={`reference-row ${selected.has(item.id) ? "selected" : ""}`}
                  key={item.id}
                  onClick={() => toggle(item.id)}
                  onContextMenu={(event) => handleContextMenu(event, item)}
                  style={tableGridStyle}
                >
                  <button className="row-check">
                    {selected.has(item.id) ? <CheckSquare /> : <Square />}
                  </button>
                  <FileIcon extension={item.extension} />
                  
                  {colOrder.map((col) => {
                    if (col === "name") return (
                      <div key="name" className={`reference-name status-${item.status} col-name`}>
                        <strong>{item.fileName}</strong>
                        <div className="progress-track">
                          <i style={{ width: `${progress}%` }} />
                        </div>
                        <small>
                          {labels[item.status]} · {bytes(item.totalDownloaded)}{" "}
                          / {bytes(item.fileSize)} ·{" "}
                          {item.status === "downloading"
                            ? `${bytes(item.speedCurrent)}/s`
                            : `${progress.toFixed(0)}%`}
                        </small>
                      </div>
                    );
                    if (col === "date") return (
                      <time key="date" className="col-date">
                        {new Date(item.createdAt).toLocaleDateString("pt-BR")}
                      </time>
                    );
                    if (col === "size") return (
                      <span key="size" className="reference-size col-size">
                        {bytes(item.fileSize)}
                      </span>
                    );
                    if (col === "status") return (
                      <span key="status" className={`status-badge status-badge--${item.status} col-status`}>
                        {labels[item.status]}
                      </span>
                    );
                    return null;
                  })}
                </article>
              );
            })
          )}
        </div>
      </div>
      {/* Menu de Contexto */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{
            top: `${contextMenu.y}px`,
            left: `${contextMenu.x}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.status === "downloading" ? (
            <button
              className="context-menu-item"
              onClick={() => {
                pause(contextMenu.downloadId);
                setContextMenu(null);
              }}
            >
              Pausar download
            </button>
          ) : ["paused", "failed", "cancelled"].includes(contextMenu.status) ? (
            <button
              className="context-menu-item"
              onClick={() => {
                resume(contextMenu.downloadId);
                setContextMenu(null);
              }}
            >
              Retomar download
            </button>
          ) : null}

          {["paused", "failed"].includes(contextMenu.status) && (
            <button
              className="context-menu-item"
              onClick={() => {
                void replaceLink(contextMenu.downloadId);
                setContextMenu(null);
              }}
            >
              Fornecer novo link
            </button>
          )}

          <button
            className="context-menu-item"
            onClick={() => {
              const val = prompt(
                "Digite o limite de velocidade para este download (em MB/s, 0 para ilimitado):",
              );
              if (val !== null) {
                const parsed = Number.parseFloat(val);
                if (Number.isFinite(parsed) && parsed >= 0) {
                  void service.updateSpeedLimit(
                    contextMenu.downloadId,
                    Math.round(parsed * 1024 * 1024),
                  );
                }
              }
              setContextMenu(null);
            }}
          >
            Limitar velocidade
          </button>

          {["pending", "downloading", "paused"].includes(
            contextMenu.status,
          ) && (
            <button
              className="context-menu-item"
              onClick={() => {
                cancel(contextMenu.downloadId);
                setContextMenu(null);
              }}
            >
              Cancelar download
            </button>
          )}

          <div className="context-menu-divider" />

          <button
            className="context-menu-item"
            onClick={() => {
              service.revealInFolder(contextMenu.filePath);
              setContextMenu(null);
            }}
          >
            Abrir pasta de destino
          </button>

          {contextMenu.status === "completed" && (
            <button
              className="context-menu-item"
              onClick={() => {
                service.openFile(contextMenu.filePath);
                setContextMenu(null);
              }}
            >
              Abrir arquivo
            </button>
          )}

          <button
            className="context-menu-item danger"
            onClick={() => {
              if (
                window.confirm("Tem certeza que deseja excluir este download?")
              ) {
                remove([contextMenu.downloadId]);
              }
              setContextMenu(null);
            }}
          >
            Excluir download
          </button>
        </div>
      )}
    </section>
  );
}
