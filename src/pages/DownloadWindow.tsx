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

  useEffect(() => {
    let fitted = false;
    const fit = async () => {
      if (!detailsOpen && !cancelOpen && fitted) return;
      const root = mainRef.current;
      if (!root) return;
      await document.fonts?.ready.catch(() => {});
      const height = root.scrollHeight || root.offsetHeight;
      if (height > 0) {
        fitted = true;
        const targetHeight = cancelOpen ? Math.max(260, height) : detailsOpen ? Math.max(340, height) : Math.max(205, height);
        void appWindow
          .setSize(new LogicalSize(450, targetHeight))
          .catch(() => {});
      }
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
        const found = list.find((item) => item.id === downloadId);
        if (found) {
          setTask(found);
          setDownloaded(found.totalDownloaded);
          setSpeed(found.speedCurrent);
          setStatus(found.status);
          setExtraction(result);
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
    progress = total ? Math.min(100, (downloaded / total) * 100) : 0,
    isCompleted = status === "completed",
    isActive = status === "downloading",
    isFailed = status === "failed" || status === "cancelled",
    remaining = isActive && speed > 0 ? (total - downloaded) / speed : -1,
    source = task.currentUrl || task.originalUrl,
    domain = sourceDomain(task.originalUrl),
    totalTime = formatElapsed(elapsedSeconds(task.createdAt, task.completedAt)),
    avgSpeed = task.speedAverage > 0 ? `${bytes(task.speedAverage)}/s` : "—",
    destination = task.finalPath.replace(/[\\/][^\\/]*$/, "");

  return (
    <main ref={mainRef} className={`dw-window status-${status} ${isCompleted ? "dw-complete" : "dw-progress"}${cancelOpen ? " cancel-open" : ""}`}>
      <header className="dw-title" data-tauri-drag-region>
        <span className="dw-title-text">
          <FileIcon extension={task.extension} />
          <span className="dw-title-name" title={task.fileName}>
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
            {isCompleted
              ? "Baixado de "
              : status === "checking_files"
              ? "Verificando arquivos de "
              : status === "assembling"
              ? "Montando arquivo de "
              : status === "extracting"
              ? "Extraindo arquivo de "
              : `${statusLabels[status]} de `}
            <span className="dw-origin-domain">{domain}</span>
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
                  <span
                    className="dw-meta-error-text"
                    title="Clique para copiar a mensagem de erro"
                    onClick={() => copyError(error)}
                  >
                    {copiedError ? <Check size={13} style={{ flexShrink: 0 }} /> : <AlertTriangle size={13} style={{ flexShrink: 0 }} />}
                    <span>{copiedError ? "Copiado!" : error}</span>
                  </span>
                  <button
                    type="button"
                    className="dw-meta-error-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      setError(null);
                    }}
                    title="Fechar aviso de erro"
                  >
                    <X size={12} />
                  </button>
                </span>
              ) : (
                <>
                  Velocidade: {isActive ? `${bytes(speed)}/s` : "—"}
                  <span className="dw-dot">•</span>
                  Tempo restante: {eta(remaining)}
                </>
              )}
            </p>
          )}

          {!isCompleted && (
            <div className={`dw-bar${isActive ? " dw-bar--active" : ""}`} role="progressbar" aria-valuenow={Math.round(progress)}>
              <i style={{ width: `${progress}%` }} />
            </div>
          )}

          {isCompleted && (
            <p className="dw-meta">
              Concluído em {formatDateTime(task.completedAt)}
              <span className="dw-dot">•</span>
              {totalTime}
            </p>
          )}

          {isCompleted && (
            <p className="dw-path" title={destination}>
              <FolderOpen size={12} />
              <span className="dw-path-value">{destination}</span>
            </p>
          )}

          {isFailed && (
            <p className="dw-meta dw-meta-error">{status === "cancelled" ? "Cancelado" : "Falhou"}</p>
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
          <div className="dw-details-header">
            <button className="dw-details-back" onClick={() => setDetailsOpen(false)}>
              <ArrowLeft size={16} />
              <span>Voltar</span>
            </button>
            <span className="dw-details-header-title">Detalhes do Download</span>
          </div>

          <div className="dw-details-body">
            <div className="dw-detail-row">
              <span>Tamanho</span>
              <b>{bytes(task.fileSize)}</b>
            </div>
            <div className="dw-detail-row">
              <span>Vel. média</span>
              <b>{avgSpeed}</b>
            </div>
            <div className="dw-detail-row">
              <span>Tempo total</span>
              <b>{totalTime}</b>
            </div>
            <div className="dw-detail-row">
              <span>Origem</span>
              <b className="dw-detail-link" title={source}>
                <Link2 size={12} />
                {domain}
                <ExternalLink size={11} />
              </b>
            </div>
            <div className="dw-detail-row">
              <span>Salvo em</span>
              <b className="dw-detail-path" title={task.finalPath}>
                {task.finalPath}
              </b>
            </div>
            <div className="dw-detail-row">
              <span>ETag</span>
              <b className="dw-detail-path">{task.etag ?? "—"}</b>
            </div>
            <div className="dw-detail-row">
              <span>Retomada</span>
              <b>{task.supportsRange ? "Suportada" : "Não suportada"}</b>
            </div>
            {extraction && (
              <div className="dw-detail-row">
                <span>Extração</span>
                <b>{extraction}</b>
              </div>
            )}
          </div>
        </div>
      )}

      {cancelOpen && (
        <div className="dw-cancel-sheet">
          <div className="dw-cancel-sheet-header">
            <div className="dw-cancel-sheet-icon">
              <AlertTriangle />
            </div>
            <div className="dw-cancel-sheet-text">
              <p className="dw-cancel-sheet-title">Cancelar este download?</p>
              <p className="dw-cancel-sheet-desc">
                Escolha se deseja manter ou remover somente parte referente a este download do disco.
              </p>
            </div>
          </div>
          <div className="dw-cancel-sheet-sep" />
          <div className="dw-cancel-sheet-actions">
            <button className="dw-cancel-btn-keep" disabled={busy} onClick={() => void cancel(false)}>
              Manter arquivos
            </button>
            <button className="dw-cancel-btn-delete" disabled={busy} onClick={() => void cancel(true)}>
              <Trash2 size={13} />
              <span>Apagar arquivos</span>
            </button>
            <button className="dw-cancel-btn-back" disabled={busy} onClick={() => setCancelOpen(false)}>
              Voltar
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
