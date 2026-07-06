import {
  Ban,
  Clock3,
  Copy,
  FolderOpen,
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
  const hours = Math.floor(seconds / 3600),
    minutes = Math.ceil((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
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

export function ProgressPage({ downloadId }: { downloadId: string }) {
  const [task, setTask] = useState<DownloadTask | null>(null),
    [downloaded, setDownloaded] = useState(0),
    [speed, setSpeed] = useState(0),
    [status, setStatus] = useState("pending"),
    [error, setError] = useState<string | null>(null),
    [limit, setLimit] = useState(""),
    [unit, setUnit] = useState<"KB" | "MB">("MB"),
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
      if (found.speedLimitDownload > 0) {
        const mb = found.speedLimitDownload >= 1024 * 1024;
        setUnit(mb ? "MB" : "KB");
        setLimit(
          String(
            Math.round(found.speedLimitDownload / (mb ? 1024 * 1024 : 1024)),
          ),
        );
      }
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
  const applyLimit = async (selectedUnit = unit) => {
    const parsed = Number(limit.replace(",", ".")),
      value =
        Number.isFinite(parsed) && parsed > 0
          ? Math.floor(parsed * (selectedUnit === "MB" ? 1024 * 1024 : 1024))
          : 0;
    await service.updateSpeedLimit(downloadId, value);
  };
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
      setDownloaded(deleteFiles ? 0 : downloaded);
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
          <span>Download em progresso</span>
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
    remaining = isActive && speed > 0 ? (total - downloaded) / speed : -1;
  return (
    <main
      className={`download-window progress-compact progress-status--${status}`}
    >
      <header
        className={`download-window-title progress-title progress-title--${status}`}
        data-tauri-drag-region
      >
        <span>
          <Gauge />
          {labels[status] ?? "Download"}
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
        <div className="progress-file">
          <FileIcon extension={task.extension} />
          <div>
            <strong title={task.fileName}>{task.fileName}</strong>
            <div className="large-progress">
              <i style={{ width: `${progress}%` }} />
            </div>
            <span className="progress-file-meta">
              {bytes(downloaded)} / {bytes(task.fileSize)}
              <button
                title="Copiar link do download"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    task.currentUrl || task.originalUrl,
                  )
                }
              >
                <Link2 />
                {sourceDomain(task.originalUrl)}
                <Copy />
              </button>
            </span>
          </div>
          <b>{progress.toFixed(0)}%</b>
        </div>
        <div className="progress-stats">
          <article>
            <Gauge />
            <span>
              Velocidade<strong>{isActive ? `${bytes(speed)}/s` : "—"}</strong>
            </span>
          </article>
          <article>
            <Clock3 />
            <span>
              Tempo restante<strong>{eta(remaining)}</strong>
            </span>
          </article>
        </div>
        <label className="progress-limit">
          <span>
            <Gauge />
            Limite de velocidade
          </span>
          <input
            inputMode="decimal"
            value={limit}
            onChange={(event) =>
              /^\d*([.,]\d*)?$/.test(event.target.value) &&
              setLimit(event.target.value)
            }
            onBlur={() => void applyLimit()}
            placeholder="Ilimitado"
          />
          <select
            value={unit}
            onChange={(event) => {
              const nextUnit = event.target.value as "KB" | "MB";
              setUnit(nextUnit);
              void applyLimit(nextUnit);
            }}
          >
            <option value="KB">KB/s</option>
            <option value="MB">MB/s</option>
          </select>
        </label>
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
                <FolderOpen />
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
