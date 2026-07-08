import {
  CheckCircle2,
  Clock3,
  FileText,
  FolderOpen,
  Gauge,
  PackageCheck,
  Copy,
  Check,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { FileIcon } from "../components/downloads/FileIcon";
import * as service from "../services/downloadService";
import type { DownloadTask } from "../domain/download";
import { elapsedSeconds, formatElapsed } from "../utils/elapsedTime";

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

const formatDateTime = (value: string | null) => {
  if (!value) return "—";
  const d = new Date(value);
  return (
    d.toLocaleDateString("pt-BR") +
    " " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  );
};

type CopyTarget = "path" | "name" | null;

export function CompletePage({ downloadId }: { downloadId: string }) {
  const [task, setTask] = useState<DownloadTask | null>(null);
  const [extraction, setExtraction] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopyTarget>(null);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    void Promise.all([
      service.listDownloads(),
      service.extractionStatus(downloadId),
    ]).then(([list, extractionResult]) => {
      setTask(list.find((item) => item.id === downloadId) ?? null);
      setExtraction(extractionResult);
      void appWindow.setSize(
        new LogicalSize(540, extractionResult ? 432 : 400),
      );
    });
  }, [downloadId]);

  const close = () => void appWindow.close();

  const copy = (text: string, target: CopyTarget) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(target);
      window.setTimeout(() => setCopied((current) => (current === target ? null : current)), 1600);
    });
  };

  if (!task)
    return (
      <main className="download-window">
        <div className="window-loading">Carregando...</div>
      </main>
    );

  const totalTime = formatElapsed(elapsedSeconds(task.createdAt, task.completedAt));
  const avgSpeed = task.speedAverage > 0 ? `${bytes(task.speedAverage)}/s` : "—";

  return (
    <main className="download-window complete-compact complete-open">
      <header className="download-window-title success" data-tauri-drag-region>
        <span>
          <CheckCircle2 />
          Download concluído
        </span>
        <button onClick={close} title="Fechar">
          <X />
        </button>
      </header>

      <section className="download-window-content complete-body">
        <div className="complete-hero">
          <FileIcon extension={task.extension} />
          <div className="complete-hero-text">
            <h1 className="complete-name" title={task.fileName}>{task.fileName}</h1>
            <span className="complete-sub">{bytes(task.fileSize)} · Concluído</span>
          </div>
        </div>

        <button
          type="button"
          className="path-row copyable"
          title={task.finalPath}
          onClick={() => copy(task.finalPath, "path")}
        >
          <span className="path-label">Salvo em</span>
          <span className="path-value" title={task.finalPath}>{task.finalPath}</span>
          <span className="path-copy">
            {copied === "path" ? <Check size={14} /> : <Copy size={14} />}
          </span>
        </button>

        <div className="complete-info">
          <div className="info-row">
            <FileText size={15} />
            <span className="info-label">Tamanho</span>
            <span className="info-value">{bytes(task.fileSize)}</span>
          </div>

          <div className="info-row">
            <Gauge size={15} />
            <span className="info-label">Vel. média</span>
            <span className="info-value">{avgSpeed}</span>
          </div>

          <div className="info-row">
            <Clock3 size={15} />
            <span className="info-label">Tempo total</span>
            <span className="info-value">{totalTime}</span>
          </div>

          <div className="info-row">
            <Clock3 size={15} />
            <span className="info-label">Concluído em</span>
            <span className="info-value">{formatDateTime(task.completedAt)}</span>
          </div>

          {extraction && (
            <div className={`info-row info-error`}>
              <PackageCheck size={15} />
              <span className="info-label">Extração</span>
              <span className="info-value">{extraction}</span>
            </div>
          )}
        </div>
      </section>

      <footer className="download-window-actions complete-actions">
        <button
          className="btn-primary"
          onClick={() => void service.openFile(task.finalPath)}
        >
          <FileText size={16} />
          Abrir arquivo
        </button>
        <button
          className="btn-secondary"
          onClick={() => void service.revealInFolder(task.finalPath)}
        >
          <FolderOpen size={16} />
          Abrir pasta
        </button>
        <button className="btn-ghost" onClick={close}>
          Fechar
        </button>
      </footer>
    </main>
  );
}
