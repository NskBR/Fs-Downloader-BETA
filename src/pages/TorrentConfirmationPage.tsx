import {
  Download,
  FolderOpen,
  X,
  Plus,
  Layers,
  FileText,
  FileVideo,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { Toggle } from "../components/ui/Toggle";
import { loadSettings } from "../services/settingsStorage";
import * as service from "../services/downloadService";

interface Payload {
  url: string;
  destination: string;
  requestId?: string;
  preview?: service.DownloadPreview;
}

interface TorrentFileNode {
  id: number;
  name: string;
  size: number;
  selected: boolean;
}

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

export function TorrentConfirmationPage({ token }: { token: string }) {
  const storageKey = `sf-downloader.confirmation-${token}`;
  const payload = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "") as Payload;
    } catch {
      return null;
    }
  }, [storageKey]);

  const appWindow = getCurrentWindow();
  const settings = useMemo(loadSettings, []);

  const savedFolder = useMemo(() => {
    try {
      return localStorage.getItem("sf-downloader.last-save-folder") || "";
    } catch {
      return "";
    }
  }, []);

  const [destination, setDestination] = useState(
    savedFolder || payload?.destination || settings.rootDownloadFolder || "",
  );
  const [torrentName, setTorrentName] = useState(
    payload?.preview?.fileName || "Torrent Download",
  );
  const [createSubfolder, setCreateSubfolder] = useState(true);
  const [autoStart, setAutoStart] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fileList, setFileList] = useState<TorrentFileNode[]>([]);

  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    if (payload?.url) {
      setError(null);
      void service
        .parseTorrentInfo(payload.url)
        .then((meta) => {
          if (!active) return;
          console.log("[TORRENT_LOG][FRONTEND_STATE] Recebido meta do torrent:", meta);
          if (!meta || !meta.files || meta.files.length === 0 || !meta.totalSize || meta.totalSize === 0) {
            setError("Não foi possível ler os metadados deste torrent.");
            setFileList([]);
            return;
          }

          setTorrentName(meta.name);
          const nodes: TorrentFileNode[] = meta.files.map((f, idx) => ({
            id: idx + 1,
            name: f.path,
            size: f.size,
            selected: true,
          }));
          setFileList(nodes);
          console.log("[TORRENT_LOG][FRONTEND_STATE] Lista armazenada no estado:", nodes);
        })
        .catch((err) => {
          if (!active) return;
          console.error("[TORRENT_LOG][FRONTEND_STATE] Falha no parsing:", err);
          setError("Não foi possível ler os metadados deste torrent.");
          setFileList([]);
        });
    }
    return () => {
      active = false;
    };
  }, [payload]);

  useEffect(() => {
    void appWindow.setSize(new LogicalSize(740, 520)).catch(() => {});
  }, [appWindow]);

  const close = () => void appWindow.close();

  const chooseFolder = async () => {
    const path = await open({ directory: true });
    if (typeof path === "string" && path.trim()) {
      setDestination(path);
      try {
        localStorage.setItem("sf-downloader.last-save-folder", path);
      } catch {}
    }
  };

  const toggleFile = (id: number) => {
    setFileList((prev) =>
      prev.map((f) => (f.id === id ? { ...f, selected: !f.selected } : f)),
    );
  };

  const selectAll = () => {
    setFileList((prev) => prev.map((f) => ({ ...f, selected: true })));
  };

  const clearSelection = () => {
    setFileList((prev) => prev.map((f) => ({ ...f, selected: false })));
  };

  const selectedFiles = fileList.filter((f) => f.selected);
  const selectedCount = selectedFiles.length;
  const totalFilesCount = fileList.length;

  const totalSize = fileList.reduce((acc, f) => acc + f.size, 0);
  const selectedSize = selectedFiles.reduce((acc, f) => acc + f.size, 0);

  const finish = async () => {
    if (!payload?.url) return;
    setBusy(true);
    setError(null);
    try {
      const task = await service.startDownload(
        payload.url,
        settings,
        destination,
        payload?.requestId,
        true,
        false,
        undefined,
        undefined,
        autoStart,
      );
      localStorage.removeItem(storageKey);
      close();
      void emit("download-created", task).catch(() => {});
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="download-window torrent-confirm-window" ref={mainRef}>
      {/* Header com drag region */}
      <header className="tc-header" data-tauri-drag-region>
        <div className="tc-header-title" data-tauri-drag-region>
          <div className="tc-header-icon-box">
            <Download size={18} />
          </div>
          <div data-tauri-drag-region>
            <h1 data-tauri-drag-region className="text-truncate" style={{ maxWidth: 500 }}>
              {torrentName}
            </h1>
            <p data-tauri-drag-region>Adicionar Torrent • Configure seu download antes de iniciar.</p>
          </div>
        </div>
        <button type="button" className="tc-close-btn" onClick={close}>
          <X size={18} />
        </button>
      </header>

      {error && <div className="tc-error-banner">{error}</div>}

      {/* Main 2-Column Body */}
      <main className="tc-body-grid">
        {/* Left Column: Settings */}
        <div className="tc-left-col">
          {/* 1. Nome do Torrent */}
          <div className="tc-card">
            <label className="tc-card-label">Nome do torrent</label>
            <input
              type="text"
              className="tc-input-name"
              value={torrentName}
              onChange={(e) => setTorrentName(e.target.value)}
            />
          </div>

          {/* 2. Pasta de destino + Alterar */}
          <div className="tc-card">
            <label className="tc-card-label">Salvar em</label>
            <div className="tc-path-row">
              <div className="tc-path-box">{destination}</div>
              <button type="button" className="tc-btn-outline" onClick={chooseFolder}>
                Alterar
              </button>
            </div>
            {/* 3. Criar subpasta */}
            <div className="tc-toggle-inline" style={{ marginTop: 6 }}>
              <Toggle checked={createSubfolder} onChange={setCreateSubfolder} />
              <span>Criar subpasta</span>
            </div>
          </div>

          {/* 7. Iniciar download automaticamente */}
          <div className="tc-card" style={{ marginTop: "auto" }}>
            <div className="tc-toggle-inline">
              <Toggle checked={autoStart} onChange={setAutoStart} />
              <div style={{ display: "flex", flexDirection: "column" }}>
                <strong style={{ color: "#ffffff", fontSize: 11.5 }}>Iniciar automaticamente</strong>
                <span style={{ fontSize: 10, color: "var(--text-2)" }}>Inicia o download assim que for adicionado.</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Torrent Content */}
        <div className="tc-right-col">
          <div className="tc-card tc-content-card">
            <div className="tc-card-header">
              <FileText size={16} className="tc-icon-cyan" />
              <strong>Conteúdo do torrent</strong>
            </div>

            {/* 4. Lista real de arquivos & 6. Tamanho selecionado */}
            <div className="tc-stats-header">
              <div className="tc-stat-pair">
                <div>
                  <span className="tc-stat-label">Tamanho total</span>
                  <strong className="tc-stat-val">{bytes(totalSize)}</strong>
                </div>
                <div className="text-right">
                  <span className="tc-stat-label">Arquivos selecionados</span>
                  <strong className="tc-stat-val">
                    {selectedCount} de {totalFilesCount} ({bytes(selectedSize)})
                  </strong>
                </div>
              </div>
            </div>

            {/* 5. Seleção de arquivos */}
            <div className="tc-actions-bar">
              <button type="button" className="tc-btn-outline" onClick={selectAll}>
                Selecionar tudo
              </button>
              <button type="button" className="tc-btn-dark" onClick={clearSelection}>
                Limpar seleção
              </button>
            </div>

            {/* Tabela de Arquivos Reais */}
            <div className="tc-table-wrap">
              <div className="tc-table-header-row">
                <span className="col-name">Nome ↓</span>
                <span className="col-size">Tamanho</span>
              </div>
              <div className="tc-table-body">
                {/* Pasta Raiz */}
                <div className="tc-file-row folder-root">
                  <input
                    type="checkbox"
                    checked={selectedCount === totalFilesCount}
                    onChange={(e) => (e.target.checked ? selectAll() : clearSelection())}
                  />
                  <FolderOpen size={14} className="tc-folder-icon" />
                  <span className="tc-file-name">{torrentName}</span>
                  <span className="tc-file-size">{bytes(totalSize)}</span>
                </div>

                {/* Linhas dos Arquivos */}
                {fileList.map((f) => (
                  <div key={f.id} className="tc-file-row child">
                    <input
                      type="checkbox"
                      checked={f.selected}
                      onChange={() => toggleFile(f.id)}
                    />
                    <FileVideo size={14} className="tc-file-icon" />
                    <span className="tc-file-name">{f.name}</span>
                    <span className="tc-file-size">{bytes(f.size)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="tc-footer">
        <div className="tc-footer-left">
          <div className="tc-layers-icon-box">
            <Layers size={18} />
          </div>
          <div>
            <strong>
              {selectedCount} de {totalFilesCount} arquivos selecionados • {bytes(selectedSize)}
            </strong>
          </div>
        </div>

        <div className="tc-footer-right">
          {/* 8. Cancelar */}
          <button type="button" className="tc-btn-dark" onClick={close}>
            Cancelar
          </button>
          {/* 9. Adicionar Torrent */}
          <button
            type="button"
            className="tc-btn-cyan-solid"
            onClick={finish}
            disabled={busy || !!error || fileList.length === 0 || selectedCount === 0}
          >
            <Plus size={16} />
            <span>Adicionar torrent</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
