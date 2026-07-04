import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { X } from "lucide-react";
import { FileIcon } from "../components/downloads/FileIcon";
import * as service from "../services/downloadService";
import type { DownloadTask } from "../domain/download";

interface CompletePageProps {
  downloadId: string;
}

export function CompletePage({ downloadId }: CompletePageProps) {
  const [task, setTask] = useState<DownloadTask | null>(null);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    // Fetch initial task state to get filenames and paths
    service.listDownloads().then(list => {
      const found = list.find(t => t.id === downloadId);
      if (found) {
        setTask(found);
      }
    }).catch(console.error);

    // Read initial checkbox setting
    const saved = localStorage.getItem("sf-downloader.dont-show-complete") === "true";
    setDontShowAgain(saved);
  }, [downloadId]);

  const closeWindow = () => {
    void appWindow.close();
  };

  const handleDontShowAgainChange = (checked: boolean) => {
    setDontShowAgain(checked);
    localStorage.setItem("sf-downloader.dont-show-complete", String(checked));
  };

  const handleOpenFolder = async () => {
    if (!task) return;
    await service.revealInFolder(task.finalPath);
    closeWindow();
  };

  const handleOpenFile = async () => {
    if (!task) return;
    await service.openFile(task.finalPath);
    closeWindow();
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

  return (
    <main className="confirm-window">
      <div className="confirm-titlebar" data-tauri-drag-region>
        <span>Download Concluído</span>
        <button onClick={closeWindow}><X size={14} /></button>
      </div>

      <section className="confirm-body xdm-confirm" style={{ gap: "8px" }}>
        {/* Sumário do Arquivo */}
        <div className="confirm-summary">
          <FileIcon extension={task.extension} />
          <div>
            <strong title={task.fileName}>{task.fileName}</strong>
            <span title={task.finalPath}>{task.finalPath}</span>
          </div>
        </div>

        {/* Opção Não Mostrar Novamente */}
        <div className="confirm-fields" style={{ display: "flex", alignItems: "center", marginTop: "12px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", color: "#aab2a4", fontSize: "11px", cursor: "pointer", userSelect: "none" }}>
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={e => handleDontShowAgainChange(e.target.checked)}
              style={{ cursor: "pointer", width: "14px", height: "14px", accentColor: "#d9ad55" }}
            />
            Não mostrar novamente esta janela ao terminar
          </label>
        </div>

        {/* Ações */}
        <footer>
          <div style={{ display: "flex", gap: "6px", marginLeft: "auto" }}>
            <button onClick={handleOpenFolder}>Abrir pasta</button>
            <button className="accent" onClick={handleOpenFile}>Abrir arquivo</button>
          </div>
        </footer>
      </section>
    </main>
  );
}
