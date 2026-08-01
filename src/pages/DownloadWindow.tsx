import {
  AlertTriangle,
  Ban,
  ChevronDown,
  Clock3,
  Copy,
  Check,
  ExternalLink,
  FileText,
  FolderOpen,
  Gauge,
  Link2,
  Minus,
  Pause,
  Play,
  Trash2,
  X,
  ArrowLeft,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { FileIcon } from "../components/downloads/FileIcon";
import * as service from "../services/downloadService";
import type { DownloadProgress, DownloadStatus, DownloadTask } from "../domain/download";
import { elapsedSeconds, formatElapsed } from "../utils/elapsedTime";

const bytes = (value: number | null) => {
  if (value === null || value < 0) return "Desconhecido";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value,
    index = 0;
  while (size >= 1024 && index < 4) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(index ? 1 : 0)} ${units[index]}`;
};

const eta = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}min`;
  const hours = Math.floor(seconds / 3600),
    minutes = Math.ceil((seconds % 3600) / 60);
  return `${hours}h ${minutes}min`;
};

const statusLabels: Record<DownloadStatus, string> = {
  pending: "Conectando",
  connecting: "Conectando",
  checking_files: "Verificando",
  downloading: "Baixando",
  paused: "Pausado",
  assembling: "Montando",
  extracting: "Extraindo",
  completed: "Concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
};

const sourceDomain = (value: string) => {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "origem desconhecida";
  }
};

const formatDateTime = (value: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  return (
    date.toLocaleDateString("pt-BR") +
    " " +
    date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  );
};

function Donut({ value, status }: { value: number; status: DownloadStatus }) {
  const size = 84,
    stroke = 6,
    radius = (size - stroke) / 2,
    circumference = 2 * Math.PI * radius,
    clamped = Math.max(0, Math.min(100, value)),
    offset = circumference - (clamped / 100) * circumference;
  const strokeColor =
    status === "completed"
      ? "var(--st-completed)"
      : status === "failed" || status === "cancelled"
      ? "var(--st-failed)"
      : status === "paused"
      ? "var(--st-paused)"
      : "url(#dw-donut-gradient)";

  return (
    <div className="dw-donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="dw-donut-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--ember-stop-1, #06b6d4)" />
            <stop offset="100%" stopColor="var(--ember-stop-2, #22d3ee)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--dw-track)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 0.4s ease, stroke 0.2s ease" }}
        />
      </svg>
      <div className="dw-donut-center">
        <strong>{Math.round(clamped)}%</strong>
        <span>{statusLabels[status]}</span>
      </div>
    </div>
  );
}

export function DownloadWindow({ downloadId }: { downloadId: string }) {
  const [task, setTask] = useState<DownloadTask | null>(null);
  const [downloaded, setDownloaded] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [status, setStatus] = useState<DownloadStatus>("pending");
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedError, setCopiedError] = useState(false);
  const [extraction, setExtraction] = useState<string | null>(null);
  const appWindow = getCurrentWindow();
  const mainRef = useRef<HTMLElement>(null);
  const notFoundCount = useRef(0);

  useEffect(() => {
    let fitted = false;
    const fit = async () => {
      if (!detailsOpen && !cancelOpen && fitted) return;
      await document.fonts?.ready.catch(() => {});
      fitted = true;
      const targetHeight = cancelOpen ? 300 : detailsOpen ? 400 : 205;
      void appWindow.setSize(new LogicalSize(450, targetHeight)).catch(() => {});
    };
    void fit();
  }, [detailsOpen, cancelOpen]);

  useEffect(() => {
    let active = true;
    const fetchTask = () => {
      void Promise.all([
        service.listDownloads(),
        service.extractionStatus(downloadId),
      ]).then(([list, result]) => {
        if (!active) return;
        const found = list.find((item) => item.id === downloadId || item.infoHash === downloadId);
        if (found) {
          notFoundCount.current = 0;
          setTask(found);
          setDownloaded(found.totalDownloaded);
          setSpeed(found.speedCurrent);
          setStatus(found.status);
          setExtraction(result);
        } else {
          notFoundCount.current += 1;
          if (notFoundCount.current >= 3) {
            void appWindow.close();
          }
        }
      });
    };

    fetchTask();
    const interval = setInterval(fetchTask, task ? 2000 : 400);

    const listener = listen<DownloadProgress>("download-progress", ({ payload }) => {
      if (payload.id !== downloadId) return;
      setDownloaded(payload.downloaded);
      setSpeed(payload.speed);
      setStatus(payload.status);
      setTask((current) => {
        if (!current) {
          fetchTask();
          return current;
        }
        return {
          ...current,
          status: payload.status,
          totalDownloaded: payload.downloaded,
          speedCurrent: payload.speed,
        };
      });
      if (payload.error) {
        setError(payload.error);
      }
    });

    return () => {
      active = false;
      clearInterval(interval);
      void listener.then((dispose) => dispose());
    };
  }, [downloadId, task === null]);

  const pauseResume = async () => {
    setError(null);
    try {
      if (["pending", "downloading"].includes(status)) {
        await service.pauseDownload(downloadId);
        setStatus("paused");
        setSpeed(0);
      } else {
        await service.resumeDownload(downloadId);
        setStatus("downloading");
      }
    } catch (cause) {
      setError(String(cause));
    }
  };

  const cancel = async (deleteFiles: boolean) => {
    setBusy(true);
    try {
      await service.cancelDownload(downloadId, deleteFiles);
      setStatus("cancelled");
      setSpeed(0);
      setCancelOpen(false);
      await appWindow.close();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const copyPath = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  const copyError = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedError(true);
      window.setTimeout(() => setCopiedError(false), 1600);
    });
  };

  if (!task)
    return (
      <main className="dw-window">
        <header className="dw-title" data-tauri-drag-region>
          <span>
            <Gauge />
            Download
          </span>
          <div className="dw-controls">
            <button title="Minimizar" onClick={() => void appWindow.minimize()}>
              <Minus />
            </button>
            <button title="Fechar" onClick={() => void appWindow.close()}>
              <X />
            </button>
          </div>
        </header>
        <div className="dw-loading">Carregando detalhes...</div>
      </main>
    );

  const total = task.fileSize ?? 0,
    isAssembling = status === "assembling",
    isExtracting = status === "extracting",
    isChecking = status === "checking_files",
    isCompleted = status === "completed",
    isActive = ["downloading", "assembling", "extracting", "checking_files"].includes(status),
    isFailed = status === "failed" || status === "cancelled",
    progress = total > 0 ? Math.min(100, (downloaded / total) * 100) : 0,
    remaining = speed > 0 && total > downloaded ? (total - downloaded) / speed : -1,
    domain = sourceDomain(task.originalUrl),
    destination = task.finalPath.replace(/[\\/][^\\/]*$/, "");

  return (
    <main ref={mainRef} className={`dw-window status-${status} ${isCompleted ? "dw-complete" : "dw-progress"}${cancelOpen ? " cancel-open" : ""}`}>
      <header className="dw-title" data-tauri-drag-region>
        <span className="dw-title-text" data-tauri-drag-region>
          <FileIcon extension={task.extension} />
          <span className="dw-title-name" title={task.fileName} data-tauri-drag-region>
            {task.fileName}
          </span>
        </span>
        <div className="dw-controls">
          <button title="Minimizar" onClick={() => void appWindow.minimize()}>
            <Minus />
          </button>
          <button title="Fechar janela" onClick={() => void appWindow.close()}>
            <X />
          </button>
        </div>
      </header>

      <section className="dw-body">
        <div className="dw-left">
          <Donut value={isCompleted ? 100 : progress} status={status} />
        </div>

        <div className="dw-right">
          <p className="dw-origin">
            {statusLabels[status]} <span className="dw-origin-domain">• {domain}</span>
          </p>

          <div className="dw-size-row">
            {!isCompleted && !isFailed && (
              <button className="dw-icon-btn" title="Pausar/Retomar" onClick={() => void pauseResume()}>
                {isActive ? <Pause /> : <Play />}
              </button>
            )}
            {isCompleted && (
              <button className="dw-icon-btn" title="Copiar destino" onClick={() => copyPath(task.finalPath)}>
                {copied ? <Check /> : <Copy />}
              </button>
            )}
            <p className="dw-size">
              {bytes(downloaded)}
              {!isCompleted && total ? <em> / {bytes(total)}</em> : null}
            </p>
          </div>

          {!isCompleted && (
            <p className="dw-meta">
              {error ? (
                <span className="dw-meta-error">
                  <AlertTriangle size={13} style={{ flexShrink: 0 }} />
                  <span>{error}</span>
                </span>
              ) : isExtracting ? (
                <span>{extraction || "Descompactando arquivos..."}</span>
              ) : isAssembling ? (
                <span>Montando partes do arquivo...</span>
              ) : isChecking ? (
                <span>Verificando integridade dos arquivos...</span>
              ) : (
                <>
                  {isActive ? `${bytes(speed)}/s` : "0 B/s"}
                  <span className="dw-dot">•</span>
                  {eta(remaining)}
                </>
              )}
            </p>
          )}

          {!isCompleted && (
            <div className={`dw-bar${isActive ? " dw-bar--active" : ""}`} role="progressbar" aria-valuenow={Math.round(progress)}>
              <i style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      </section>

      {!cancelOpen && (
        <>
          <div className="dw-divider" />

          <footer className="dw-footer">
            <button className="dw-details-toggle" onClick={() => setDetailsOpen((value) => !value)}>
              <ChevronDown className={detailsOpen ? "open" : ""} />
              Mais detalhes
            </button>

            {isCompleted ? (
              <div className="dw-footer-actions">
                <button className="dw-btn-primary" onClick={() => void service.openFile(task.finalPath)}>
                  <FileText size={16} />
                  Abrir arquivo
                </button>
                <button className="dw-btn-ghost" onClick={() => void service.revealInFolder(task.finalPath)}>
                  <FolderOpen size={16} />
                  Abrir pasta
                </button>
              </div>
            ) : (
              <button className="dw-btn-cancel" onClick={() => setCancelOpen(true)}>
                <Ban size={15} />
                Cancelar
              </button>
            )}
          </footer>
        </>
      )}

      {detailsOpen && !cancelOpen && (
        <div className="dw-details dw-details-full">
          <div className="dw-details-header" data-tauri-drag-region>
            <button className="dw-details-back nodrag" onClick={() => setDetailsOpen(false)}>
              <ArrowLeft size={16} />
              Voltar
            </button>
            <span className="dw-details-header-title">Detalhes do Download</span>
          </div>

          <div className="dw-details-compact-body">
            <div className="dw-details-card">
              <div className="dw-detail-row">
                <span className="dw-detail-label">Velocidade Atual</span>
                <span className="dw-detail-val">{bytes(speed)}/s</span>
              </div>
              <div className="dw-detail-row">
                <span className="dw-detail-label">Tempo Restante</span>
                <span className="dw-detail-val">{eta(remaining)}</span>
              </div>
              <div className="dw-detail-row">
                <span className="dw-detail-label">Tempo Decorrido</span>
                <span className="dw-detail-val">{formatElapsed(elapsedSeconds(task.createdAt, task.completedAt))}</span>
              </div>
              <div className="dw-detail-row">
                <span className="dw-detail-label">Criado em</span>
                <span className="dw-detail-val">{formatDateTime(task.createdAt)}</span>
              </div>
              <div className="dw-detail-row">
                <span className="dw-detail-label">Concluído em</span>
                <span className="dw-detail-val">{formatDateTime(task.completedAt)}</span>
              </div>
              <div className="dw-detail-row">
                <span className="dw-detail-label">URL Original</span>
                <span className="dw-detail-val dw-detail-url" title={task.originalUrl}>{task.originalUrl}</span>
              </div>
              <div className="dw-detail-row">
                <span className="dw-detail-label">Pasta de Destino</span>
                <span className="dw-detail-val">{destination}</span>
              </div>
            </div>

            <div className="dw-mini-actions-row">
              <button className="dw-mini-action-btn" onClick={() => void service.revealInFolder(task.finalPath)}>
                <FolderOpen size={14} className="icon-blue" />
                <span>Abrir pasta</span>
              </button>
              <button className="dw-mini-action-btn" onClick={() => copyPath(task.originalUrl)}>
                <Link2 size={14} className="icon-blue" />
                <span>Copiar URL</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelOpen && (
        <div className="dw-confirm-cancel">
          <p>Deseja cancelar este download?</p>
          <div className="dw-confirm-cancel-actions">
            <button className="dw-btn-danger" onClick={() => void cancel(true)}>
              Excluir arquivos
            </button>
            <button className="dw-btn-warning" onClick={() => void cancel(false)}>
              Manter arquivos
            </button>
            <button className="dw-btn-secondary" onClick={() => setCancelOpen(false)}>
              Voltar
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
