import {
  CheckCircle2,
  FileText,
  FolderOpen,
  PackageCheck,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FileIcon } from "../components/downloads/FileIcon";
import * as service from "../services/downloadService";
import type { DownloadTask } from "../domain/download";

const bytes = (value: number | null) => {
  if (value === null) return "Desconhecido";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value,
    index = 0;
  while (size >= 1024 && index < 4) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(index ? 1 : 0)} ${units[index]}`;
};
export function CompletePage({ downloadId }: { downloadId: string }) {
  const [task, setTask] = useState<DownloadTask | null>(null),
    [extraction, setExtraction] = useState<string | null>(null),
    appWindow = getCurrentWindow();
  useEffect(() => {
    void service
      .listDownloads()
      .then((list) =>
        setTask(list.find((item) => item.id === downloadId) ?? null),
      );
    void service.extractionStatus(downloadId).then(setExtraction);
  }, [downloadId]);
  const close = () => void appWindow.close();
  if (!task)
    return (
      <main className="download-window">
        <div className="window-loading">Carregando...</div>
      </main>
    );
  return (
    <main className="download-window complete-compact">
      <header className="download-window-title success" data-tauri-drag-region>
        <span>
          <CheckCircle2 />
          Download concluído
        </span>
        <button onClick={close}>
          <X />
        </button>
      </header>
      <section className="download-window-content">
        <div className="complete-file">
          <FileIcon extension={task.extension} />
          <div>
            <strong>{task.fileName}</strong>
            <span>
              <FolderOpen />
              Salvo em <b>{task.finalPath}</b>
            </span>
            <span>
              <FileText />
              Tamanho final <b>{bytes(task.fileSize)}</b>
            </span>
            <span>
              <CheckCircle2 />
              Status <b>Concluído</b>
            </span>
            {extraction && (
              <span
                className={
                  extraction.startsWith("Erro") ? "extraction-error" : ""
                }
              >
                <PackageCheck />
                Extração <b>{extraction}</b>
              </span>
            )}
          </div>
        </div>
      </section>
      <footer className="download-window-actions complete-actions">
        <button
          className="primary"
          onClick={() => void service.openFile(task.finalPath)}
        >
          <FileText />
          Abrir arquivo
        </button>
        <button
          className="primary"
          onClick={() => void service.revealInFolder(task.finalPath)}
        >
          <FolderOpen />
          Abrir pasta
        </button>
        <button onClick={close}>
          <X />
          Fechar
        </button>
      </footer>
    </main>
  );
}
