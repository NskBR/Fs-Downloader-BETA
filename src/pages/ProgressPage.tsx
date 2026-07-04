import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { X, Minus } from "lucide-react";
import { FileIcon } from "../components/downloads/FileIcon";
import * as service from "../services/downloadService";
import type { DownloadTask, DownloadProgress } from "../domain/download";

interface ProgressPageProps {
  downloadId: string;
}

const bytes = (value: number | null) => {
  if (value === null || value === -1) return "Tamanho desconhecido";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value, index = 0;
  while (size >= 1024 && index < 4) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(index ? 1 : 0)} ${units[index]}`;
};

const formatTimeLeft = (seconds: number) => {
  if (seconds === Infinity || isNaN(seconds) || seconds < 0) return "Desconhecido";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

export function ProgressPage({ downloadId }: ProgressPageProps) {
  const [task, setTask] = useState<DownloadTask | null>(null);
  const [downloaded, setDownloaded] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [status, setStatus] = useState("pending");
  const [error, setError] = useState<string | null>(null);
  const [limitValue, setLimitValue] = useState<string>("");
  const [limitUnit, setLimitUnit] = useState<"KB" | "MB">("MB");
  const appWindow = getCurrentWindow();

  const handleApplyLimit = async (val: string, unit: "KB" | "MB") => {
    if (!task) return;
    let bytesPerSec = 0;
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed > 0) {
      bytesPerSec = Math.floor(parsed * (unit === "MB" ? 1024 * 1024 : 1024));
    }
    try {
      await service.updateSpeedLimit(downloadId, bytesPerSec);
      setTask(prev => prev ? { ...prev, speedLimitDownload: bytesPerSec } : null);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    // Fetch initial task state
    service.listDownloads().then(list => {
      const found = list.find(t => t.id === downloadId);
      if (found) {
        setTask(found);
        setDownloaded(found.totalDownloaded);
        setSpeed(found.speedCurrent);
        setStatus(found.status);
        if (found.speedLimitDownload && found.speedLimitDownload > 0) {
          if (found.speedLimitDownload >= 1024 * 1024) {
            setLimitValue((found.speedLimitDownload / (1024 * 1024)).toFixed(0));
            setLimitUnit("MB");
          } else {
            setLimitValue((found.speedLimitDownload / 1024).toFixed(0));
            setLimitUnit("KB");
          }
        } else {
          setLimitValue("");
        }
      }
    }).catch(console.error);

    // Listen to real-time progress updates
    const unlistenPromise = listen<DownloadProgress>("download-progress", ({ payload }) => {
      if (payload.id === downloadId) {
        setDownloaded(payload.downloaded);
        setSpeed(payload.speed);
        setStatus(payload.status);
        setTask(current => current ? { ...current, status: payload.status, totalDownloaded: payload.downloaded, speedCurrent: payload.speed } : current);
        if (payload.error) {
          setError(payload.error);
        }
      }
    });

    return () => {
      void unlistenPromise.then(dispose => dispose());
    };
  }, [downloadId]);

  const closeWindow = () => {
    void appWindow.close();
  };

  const minimizeWindow = () => {
    void appWindow.minimize();
  };

  const handlePauseResume = async () => {
    if (!task) return;
    setError(null);
    try {
      if (status === "downloading" || status === "pending") {
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

  const handleCancel = async () => {
    await service.cancelDownload(downloadId);
    setStatus("cancelled");
    setSpeed(0);
  };

  if (!task) {
    return (
      <main className="confirm-window">
        <div className="confirm-titlebar" data-tauri-drag-region>
          <span>Carregando...</span>
          <button onClick={closeWindow}><X size={14} /></button>
        </div>
        <div className="confirm-empty">
          Buscando detalhes do download...
        </div>
      </main>
    );
  }

  const totalSize = task.fileSize || 0;
  const progressPercent = totalSize > 0 ? Math.min(100, (downloaded / totalSize) * 100) : 0;
  const remainingBytes = totalSize - downloaded;
  const timeLeftSeconds = speed > 0 ? remainingBytes / speed : -1;

  const statusLabel =
    status === "downloading" ? "Baixando" :
    status === "checking_files" ? "Verificando arquivos..." :
    status === "assembling" ? "Montando arquivo..." :
    status === "extracting" ? "Extraindo arquivo..." :
    status === "paused" ? "Pausado" :
    status === "pending" ? "Conectando..." :
    status === "failed" ? "Falhou" :
    status === "cancelled" ? "Cancelado" : "Pronto";

  const isDownloading = status === "downloading";

  return (
    <main className="confirm-window">
      <div className="confirm-titlebar" data-tauri-drag-region>
        <span>
          {progressPercent > 0 ? `${progressPercent.toFixed(0)}% ` : ""}Progresso do download
        </span>
        <div style={{ display: "flex", alignItems: "center" }}>
          <button 
            onClick={minimizeWindow} 
            style={{ width: "36px", height: "32px", display: "grid", placeItems: "center", border: 0, color: "#aeb6a8", background: "transparent", cursor: "pointer" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <Minus size={14} />
          </button>
          <button onClick={closeWindow}><X size={14} /></button>
        </div>
      </div>

      <section className="confirm-body xdm-confirm" style={{ gap: "8px" }}>
        {/* Sumário do Arquivo */}
        <div className="confirm-summary">
          <FileIcon extension={task.extension} />
          <div>
            <strong title={task.fileName}>{task.fileName}</strong>
            <span title={task.originalUrl}>{task.originalUrl}</span>
          </div>
        </div>

        {/* Detalhes de Progresso */}
        <div className="confirm-fields" style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#eef1f7", fontSize: "13px", fontWeight: "600" }}>
            <span>{statusLabel} · {bytes(downloaded)} de {bytes(totalSize)}</span>
            <span style={{ fontWeight: "750", color: "#f0a45b" }}>{isDownloading && speed > 0 ? `${bytes(speed)}/s` : "—"}</span>
          </div>
          
          <div className="progress-track" style={{ height: "6px", width: "100%", background: "#1a1f29", borderRadius: "3px", overflow: "hidden", margin: "4px 0" }}>
            <div style={{ height: "100%", width: `${progressPercent}%`, background: "linear-gradient(90deg, #d9ad55 0%, #b58d3d 100%)", borderRadius: "3px", transition: "width 0.2s" }} />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "#b8c2d2", fontSize: "11px" }}>
            <span>Tempo restante: {isDownloading && speed > 0 ? formatTimeLeft(timeLeftSeconds) : "—"}</span>
            <div className="speed-limit-control">
              <span>Limite</span>
              <input
                type="number"
                min="0"
                placeholder="Sem"
                value={limitValue}
                onChange={e => setLimitValue(e.target.value)}
                onBlur={() => handleApplyLimit(limitValue, limitUnit)}
                onKeyDown={e => e.key === "Enter" && handleApplyLimit(limitValue, limitUnit)}
              />
              <select
                value={limitUnit}
                onChange={e => {
                  const newUnit = e.target.value as "KB" | "MB";
                  setLimitUnit(newUnit);
                  handleApplyLimit(limitValue, newUnit);
                }}
              >
                <option value="KB" style={{ background: "#11130f", color: "#edf1e8" }}>KB/s</option>
                <option value="MB" style={{ background: "#11130f", color: "#edf1e8" }}>MB/s</option>
              </select>
            </div>
          </div>
        </div>

        {error && (
          <p className="confirm-error" style={{ margin: "5px 0 0" }}>Erro: {error}</p>
        )}

        {/* Ações */}
        <footer>
          <button onClick={closeWindow}>Ocultar</button>
          <div style={{ display: "flex", gap: "6px", marginLeft: "auto" }}>
            {["pending","checking_files","downloading","paused"].includes(status)&&<button onClick={handleCancel}>Cancelar</button>}
            {["pending","downloading","paused","failed","cancelled"].includes(status)&&<button className="accent" onClick={handlePauseResume}>
              {["paused","failed","cancelled"].includes(status) ? "Retomar" : "Pausar"}
            </button>}
            {status==="completed"&&<><button onClick={()=>void service.revealInFolder(task.finalPath)}>Abrir pasta</button><button className="accent" onClick={()=>void service.openFile(task.finalPath)}>Abrir arquivo</button></>}
          </div>
        </footer>
      </section>
    </main>
  );
}
