import {
  AlertTriangle,
  Ban,
  ChevronDown,
  Clock3,
  Copy,
  Check,
  FileText,
  FolderOpen,
  Gauge,
  Minus,
  Pause,
  Play,
  X,
  ArrowLeft,
  Users,
  Globe,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { FileIcon } from "../components/downloads/FileIcon";
import * as service from "../services/downloadService";
import type { DownloadStatus, DownloadTask } from "../domain/download";
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
  pending: "Aguardando",
  connecting: "Conectando P2P",
  checking_files: "Verificando arquivos",
  downloading: "Baixando",
  paused: "Pausado",
  assembling: "Montando",
  extracting: "Extraindo arquivo",
  completed: "Semeando",
  failed: "Falhou",
  cancelled: "Cancelado",
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
        <span>{statusLabels[status] || "Torrent"}</span>
      </div>
    </div>
  );
}

interface TorrentProgressPayload {
  id: string;
  downloaded: number;
  verifiedBytes?: number;
  total: number | null;
  speed: number;
  uploadSpeed?: number;
  seeds?: number;
  peers?: number;
  trackers?: number;
  status: string;
  error?: string | null;
}

export function TorrentProgressWindow({ downloadId }: { downloadId: string }) {
  const [task, setTask] = useState<DownloadTask | null>(null);
  const [downloaded, setDownloaded] = useState(0);
  const [verifiedBytes, setVerifiedBytes] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0);
  const [peers, setPeers] = useState(0);
  const [trackers, setTrackers] = useState(0);
  const [status, setStatus] = useState<DownloadStatus>("pending");
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const appWindow = getCurrentWindow();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let fitted = false;
    const fit = async () => {
      if (!detailsOpen && !cancelOpen && fitted) return;
      await document.fonts?.ready.catch(() => {});
      fitted = true;
      const targetHeight = cancelOpen ? 300 : detailsOpen ? 420 : 205;
      void appWindow.setSize(new LogicalSize(470, targetHeight)).catch(() => {});
    };
    void fit();
  }, [detailsOpen, cancelOpen]);

  useEffect(() => {
    let active = true;
    const fetchTask = () => {
      void service.listDownloads().then((list) => {
        if (!active) return;
        const found = list.find((item) => item.id === downloadId);
        if (found) {
          setTask(found);
          setDownloaded(found.totalDownloaded);
          setSpeed(found.speedCurrent);
          setUploadSpeed(found.uploadSpeed ?? 0);
          setPeers(found.peers ?? 0);
          setStatus((prev) => (prev === "pending" ? found.status : prev));
        }
      });
    };

    fetchTask();
    const interval = setInterval(fetchTask, task ? 2000 : 400);

    const listener = listen<TorrentProgressPayload>("download-progress", ({ payload }) => {
      if (payload.id !== downloadId) {
        return;
      }
      setDownloaded(payload.downloaded);
      if (payload.verifiedBytes !== undefined) setVerifiedBytes(payload.verifiedBytes);
      setSpeed(payload.speed);
      if (payload.uploadSpeed !== undefined) setUploadSpeed(payload.uploadSpeed);
      if (payload.peers !== undefined) setPeers(payload.peers);
      if (payload.trackers !== undefined) setTrackers(payload.trackers);
      setStatus(payload.status as DownloadStatus);
      setTask((current) => {
        if (!current) {
          fetchTask();
          return current;
        }
        return {
          ...current,
          status: payload.status as DownloadStatus,
          totalDownloaded: payload.downloaded,
          speedCurrent: payload.speed,
        };
      });
      if (payload.error) setError(payload.error);
    });

    return () => {
      active = false;
      clearInterval(interval);
      void listener.then((dispose) => dispose());
    };
  }, [downloadId, task === null]);

  const pauseResume = async () => {
    setError(null);
    const taskId = task?.id ?? downloadId;
    try {
      if (["pending", "connecting", "downloading"].includes(status)) {
        await service.pauseDownload(taskId);
        setStatus("paused");
        setSpeed(0);
      } else {
        await service.resumeDownload(taskId);
        setStatus("downloading");
      }
    } catch (cause) {
      setError(String(cause));
    }
  };

  const cancel = async (deleteFiles: boolean) => {
    setBusy(true);
    try {
      // downloadId é o infoHash — cancelTorrent usa info_hash
      await service.cancelTorrent(task?.infoHash ?? downloadId, deleteFiles);
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

  if (!task)
    return (
      <main className="dw-window">
        <header className="dw-title" data-tauri-drag-region>
          <span>
            <Gauge />
            Download Torrent
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
        <div className="dw-loading">Carregando torrent...</div>
      </main>
    );

  const total = task.fileSize ?? 0,
    isChecking = status === "checking_files",
    isCompleted = status === "completed",
    isActive = status === "downloading",
    isFailed = status === "failed" || status === "cancelled",
    // Durante verificação, mostramos progresso de verificação no donut
    verifyProgress = isChecking && total > 0 ? Math.min(100, (verifiedBytes / total) * 100) : 0,
    downloadProgress = total > 0 ? Math.min(100, (downloaded / total) * 100) : 0,
    progress = isChecking ? verifyProgress : (isCompleted ? 100 : downloadProgress),
    remaining = isActive && speed > 0 && total > downloaded ? (total - downloaded) / speed : -1,
    destination = task.finalPath.replace(/[\\/][^\\/]*$/, "");

  return (
    <main ref={mainRef} className={`dw-window torrent-download-window status-${status} ${isCompleted ? "dw-complete" : "dw-progress"}${cancelOpen ? " cancel-open" : ""}`}>
      <header className="dw-title" data-tauri-drag-region>
        <span className="dw-title-text" data-tauri-drag-region>
          <FileIcon extension={task.extension || "torrent"} />
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
            {statusLabels[status]} <span className="dw-origin-domain">• P2P BitTorrent</span>
          </p>

          <div className="dw-size-row">
            {!isCompleted && !isFailed && !isChecking && (
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
              {isChecking ? (
                // Mostra progresso de verificação, não bytes baixados
                <><span style={{ opacity: 0.7, fontSize: "0.85em" }}>Verificado: </span>{bytes(verifiedBytes)}<em> / {bytes(total)}</em></>
              ) : (
                <>{bytes(downloaded)}{!isCompleted && total ? <em> / {bytes(total)}</em> : null}</>
              )}
            </p>
          </div>

          {!isCompleted && (
            <p className="dw-meta">
              {error ? (
                <span className="dw-meta-error">
                  <AlertTriangle size={13} style={{ flexShrink: 0 }} />
                  <span>{error}</span>
                </span>
              ) : isChecking ? (
                <span style={{ opacity: 0.75, fontSize: "0.85em" }}>Verificando integridade dos arquivos existentes...</span>
              ) : (
                <>
                  ⬇️ {isActive ? `${bytes(speed)}/s` : "0 B/s"}
                  <span className="dw-dot">•</span>
                  👥 {peers} pares
                  <span className="dw-dot">•</span>
                  ⏱ {eta(remaining)}
                </>
              )}
            </p>
          )}

          {!isCompleted && (
            <div className={`dw-bar${isActive ? " dw-bar--active" : ""}${isChecking ? " dw-bar--checking" : ""}`} role="progressbar" aria-valuenow={Math.round(progress)}>
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
            <span className="dw-details-header-title">Detalhes Técnicos do Torrent</span>
          </div>

          <div className="dw-details-compact-body">
            <div className="dw-details-card">
              <div className="dw-detail-row">
                <span className="dw-detail-label">Velocidade Download</span>
                <span className="dw-detail-val">{bytes(speed)}/s</span>
              </div>
              <div className="dw-detail-row">
                <span className="dw-detail-label">Velocidade Upload</span>
                <span className="dw-detail-val">{bytes(uploadSpeed)}/s</span>
              </div>
              <div className="dw-detail-row">
                <span className="dw-detail-label">Conexões P2P</span>
                <span className="dw-detail-val">{peers} pares conectando/ativos</span>
              </div>
              <div className="dw-detail-row">
                <span className="dw-detail-label">Trackers Ativos</span>
                <span className="dw-detail-val">{trackers || "Não informado"}</span>
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
            </div>
          </div>
        </div>
      )}

      {cancelOpen && (
        <div className="dw-confirm-cancel">
          <p>Deseja cancelar o download deste torrent?</p>
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
