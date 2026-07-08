import {
  Ban,
  Check,
  Clock3,
  Copy,
  ExternalLink,
  Gauge,
  Link2,
  Minus,
  Pause,
  Play,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { FileIcon } from "../components/downloads/FileIcon";
import * as service from "../services/downloadService";
import type { DownloadProgress, DownloadTask } from "../domain/download";

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
const labels: Record<string, string> = {
  pending: "Conectando",
  checking_files: "Verificando arquivos",
  downloading: "Baixando",
  paused: "Pausado",
  assembling: "Montando arquivo",
  extracting: "Extraindo arquivo",
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

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy-btn"
      title={`Copiar ${label}`}
      onClick={() =>
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        })
      }
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      <span>{copied ? "Copiado" : label}</span>
    </button>
  );
}

export function ProgressPage({ downloadId }: { downloadId: string }) {
  const [task, setTask] = useState<DownloadTask | null>(null),
    [downloaded, setDownloaded] = useState(0),
    [speed, setSpeed] = useState(0),
    [status, setStatus] = useState("pending"),
    [error, setError] = useState<string | null>(null),
    [nameCopied, setNameCopied] = useState(false),
    [cancelOpen, setCancelOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    void service.listDownloads().then((list) => {
      const found = list.find((item) => item.id === downloadId);
      if (!found) return;
      setTask(found);
      setDownloaded(found.totalDownloaded);
      setSpeed(found.speedCurrent);
      setStatus(found.status);
    });
    const listener = listen<DownloadProgress>(
      "download-progress",
      ({ payload }) => {
        if (payload.id !== downloadId) return;
        setDownloaded(payload.downloaded);
        setSpeed(payload.speed);
        setStatus(payload.status);
        setTask((current) =>
          current
            ? {
                ...current,
                status: payload.status,
                totalDownloaded: payload.downloaded,
                speedCurrent: payload.speed,
              }
            : current,
        );
        setError(payload.error);
      },
    );
    return () => void listener.then((dispose) => dispose());
  }, [downloadId]);

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

  if (!task)
    return (
      <main className="download-window">
        <header className="download-window-title" data-tauri-drag-region>
          <span>
            <Gauge />
            Download em progresso
          </span>
          <div className="download-window-controls">
            <button title="Minimizar" onClick={() => void appWindow.minimize()}>
              <Minus />
            </button>
            <button title="Fechar janela" onClick={() => void appWindow.close()}>
              <X />
            </button>
          </div>
        </header>
        <div className="window-loading">Carregando detalhes...</div>
      </main>
    );

  const total = task.fileSize ?? 0,
    progress = total ? Math.min(100, (downloaded / total) * 100) : 0,
    isActive = status === "downloading",
    remaining = isActive && speed > 0 ? (total - downloaded) / speed : -1,
    source = task.currentUrl || task.originalUrl;

  return (
    <main className={`download-window progress-compact status-${status} progress-open`}>
      <header className="download-window-title" data-tauri-drag-region>
        <span className="progress-title-text">
          <Gauge />
          <span className="progress-title-label">{labels[status] ?? "Download"}</span>
          <span className="progress-title-name" title={task.fileName}>
            {task.fileName}
          </span>
        </span>
        <div className="download-window-controls">
          <button title="Minimizar" onClick={() => void appWindow.minimize()}>
            <Minus />
          </button>
          <button title="Fechar janela" onClick={() => void appWindow.close()}>
            <X />
          </button>
        </div>
      </header>

      <section className="download-window-content">
        <div className="pg-head">
          <FileIcon extension={task.extension} />
          <strong
            className="pg-name"
            title={task.fileName}
            onClick={() =>
              void navigator.clipboard.writeText(task.fileName).then(() => {
                setNameCopied(true);
                window.setTimeout(() => setNameCopied(false), 1600);
              })
            }
          >
            {task.fileName}
          </strong>
          <span className="pg-percent">{progress.toFixed(0)}%</span>
        </div>

        <div
          className="large-progress"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <i style={{ width: `${progress}%` }} />
        </div>

        <div className="pg-stats">
          <span className="pg-size">
            <strong>{bytes(downloaded)}</strong>{" "}
            <em>/ {bytes(task.fileSize)}</em>
          </span>
          <span className="pg-stat">
            <Gauge size={13} />
            {isActive ? `${bytes(speed)}/s` : "—"}
          </span>
          <span className="pg-stat">
            <Clock3 size={13} />
            {eta(remaining)}
          </span>
        </div>

        <div className="pg-origin">
          <button
            type="button"
            className="pg-origin-link"
            title={`${source} — clique para abrir`}
            onClick={() => void service.openUrl(source)}
          >
            <Link2 size={12} />
            <span className="pg-origin-value">{sourceDomain(task.originalUrl)}</span>
            <ExternalLink size={11} />
          </button>
          <CopyButton value={source} label="Copiar" />
        </div>

        {nameCopied && <span className="copy-toast">Nome copiado</span>}
        {error && <p className="window-error">{error}</p>}
      </section>

      <footer className="progress-actions">
        {["pending", "downloading"].includes(status) && (
          <button className="pause" onClick={() => void pauseResume()}>
            <Pause />
            Pausar
          </button>
        )}
        {["paused", "failed", "cancelled"].includes(status) && (
          <button className="resume" onClick={() => void pauseResume()}>
            <Play />
            Retomar
          </button>
        )}
        {!["completed", "cancelled"].includes(status) && (
          <button className="cancel" onClick={() => setCancelOpen(true)}>
            <Ban />
            Cancelar
          </button>
        )}
      </footer>

      {cancelOpen && (
        <div className="cancel-overlay">
          <section className="cancel-dialog">
            <header>
              <span>Cancelar download?</span>
              <button onClick={() => setCancelOpen(false)}>
                <X />
              </button>
            </header>
            <div>
              <i>!</i>
              <p>
                <strong>Deseja realmente cancelar este download?</strong>
                <span>
                  Você pode manter os arquivos parciais para tentar retomar
                  depois ou apagá-los agora.
                </span>
              </p>
            </div>
            <footer>
              <button disabled={busy} onClick={() => void cancel(false)}>
                Manter arquivos
              </button>
              <button
                className="delete"
                disabled={busy}
                onClick={() => void cancel(true)}
              >
                <Trash2 />
                Apagar arquivos
              </button>
              <button disabled={busy} onClick={() => setCancelOpen(false)}>
                Voltar
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
