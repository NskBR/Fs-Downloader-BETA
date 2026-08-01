import {
  Folder,
  Pause,
  Play,
  X,
  Users,
  Globe,
  Gauge,
  Clock,
} from "lucide-react";
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import type { DownloadTask } from "../domain/download";
import * as service from "../services/downloadService";

const bytes = (value: number | null) => {
  if (value === null || value === undefined || value < 0) return "Desconhecido";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value,
    index = 0;
  while (size >= 1024 && index < 4) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(index >= 3 ? 2 : index ? 1 : 0)} ${units[index]}`;
};

const formatSpeed = (bytesPerSec: number) => {
  if (bytesPerSec <= 0) return "0 B/s";
  const mb = bytesPerSec / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  const kb = bytesPerSec / 1024;
  return `${kb.toFixed(0)} KB/s`;
};

const formatTime = (seconds: number | null) => {
  if (seconds === null || seconds <= 0 || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
};

interface TorrentProgressEvent {
  id: string;
  downloaded: number;
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
  const appWindow = getCurrentWindow();
  const [task, setTask] = useState<DownloadTask | null>(null);
  const [liveData, setLiveData] = useState<TorrentProgressEvent | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void appWindow.setSize(new LogicalSize(520, 275)).catch(() => {});
  }, [appWindow]);

  useEffect(() => {
    void service.listDownloads().then((items) => {
      const found = items.find((i) => i.id === downloadId);
      if (found) setTask(found);
    });

    const unlisten = listen<TorrentProgressEvent>("download-progress", (event) => {
      if (event.payload && event.payload.id === downloadId) {
        setLiveData(event.payload);
        setTask((prev) =>
          prev
            ? {
                ...prev,
                totalDownloaded: event.payload.downloaded,
                fileSize: event.payload.total,
                speedCurrent: event.payload.speed,
                seeds: event.payload.seeds ?? prev.seeds,
                peers: event.payload.peers ?? prev.peers,
                status: event.payload.status as any,
              }
            : prev,
        );
      }
    });

    return () => {
      void unlisten.then((u) => u());
    };
  }, [downloadId]);

  const close = () => void appWindow.close();

  const handlePauseResume = async () => {
    if (!task || busy) return;
    setBusy(true);
    try {
      if (task.status === "downloading") {
        await service.pauseDownload(task.id);
        setTask((prev) => (prev ? { ...prev, status: "paused" } : null));
      } else {
        await service.resumeDownload(task.id);
        setTask((prev) => (prev ? { ...prev, status: "downloading" } : null));
      }
    } catch {
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!task || busy) return;
    setBusy(true);
    try {
      await service.cancelDownload(task.id, false);
      close();
    } catch {
      setBusy(false);
    }
  };

  const downloaded = liveData?.downloaded ?? task?.totalDownloaded ?? 0;
  const total = liveData?.total ?? task?.fileSize ?? null;
  const speed = liveData?.speed ?? task?.speedCurrent ?? 0;
  const peersCount = liveData?.peers ?? task?.peers ?? 0;
  const trackersCount = liveData?.trackers ?? 0;
  const isPaused = task?.status === "paused";

  const percent = total && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : (downloaded > 0 ? 100 : 0);
  const etaSeconds = speed > 0 && total && total > downloaded ? (total - downloaded) / speed : null;

  // Donut SVG circumference calculation
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  return (
    <div className="download-window torrent-live-window">
      {/* Header Row com drag region */}
      <div className="tl-header" data-tauri-drag-region>
        <div className="tl-title-group" data-tauri-drag-region>
          <div className="tl-folder-box">
            <Folder size={22} className="tl-folder-icon" />
          </div>
          <h2 className="tl-title text-truncate" data-tauri-drag-region>
            {task?.fileName || "Torrent Download"}
          </h2>
        </div>

        {/* Circular Donut Progress */}
        <div className="tl-donut-wrap">
          <svg className="tl-donut-svg" viewBox="0 0 100 100">
            <circle
              className="tl-donut-bg"
              cx="50"
              cy="50"
              r={radius}
              strokeWidth="7"
            />
            <circle
              className="tl-donut-fg"
              cx="50"
              cy="50"
              r={radius}
              strokeWidth="7"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
            />
          </svg>
          <div className="tl-donut-text">
            <strong>{percent}%</strong>
            <span>concluído</span>
          </div>
        </div>
      </div>

      {/* Progress Bar Track */}
      <div className="tl-progress-group">
        <div className="tl-progress-bar-wrap">
          <div className="tl-progress-bar-fill" style={{ width: `${percent}%` }} />
        </div>
        <div className="tl-progress-labels">
          <span>
            {bytes(downloaded)} de {bytes(total)}
          </span>
          <span className="tl-percent-cyan">{percent}%</span>
        </div>
      </div>

      {/* 1x4 Metrics Cards */}
      <div className="tl-metrics-grid">
        <div className="tl-metric-card">
          <Users size={16} className="tl-m-icon" />
          <div className="tl-m-text">
            <span className="tl-m-label">Peers</span>
            <strong className="tl-m-val">{peersCount}</strong>
          </div>
        </div>

        <div className="tl-metric-card">
          <Globe size={16} className="tl-m-icon" />
          <div className="tl-m-text">
            <span className="tl-m-label">Trackers</span>
            <strong className="tl-m-val">{trackersCount}</strong>
          </div>
        </div>

        <div className="tl-metric-card">
          <Gauge size={16} className="tl-m-icon" />
          <div className="tl-m-text">
            <span className="tl-m-label">Velocidade</span>
            <strong className="tl-m-val">{formatSpeed(speed)}</strong>
          </div>
        </div>

        <div className="tl-metric-card">
          <Clock size={16} className="tl-m-icon" />
          <div className="tl-m-text">
            <span className="tl-m-label">Tempo restante</span>
            <strong className="tl-m-val">{formatTime(etaSeconds)}</strong>
          </div>
        </div>
      </div>

      {/* Footer Buttons */}
      <div className="tl-footer">
        <button
          type="button"
          className="tl-btn-pause"
          onClick={handlePauseResume}
          disabled={busy}
        >
          {isPaused ? <Play size={14} /> : <Pause size={14} />}
          <span>{isPaused ? "Retomar" : "Pausar"}</span>
        </button>

        <button
          type="button"
          className="tl-btn-cancel"
          onClick={handleCancel}
          disabled={busy}
        >
          <X size={14} />
          <span>Cancelar</span>
        </button>
      </div>
    </div>
  );
}
