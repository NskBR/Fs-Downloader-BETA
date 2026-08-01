import {
  Download,
  Folder,
  FolderOpen,
  Settings,
  Check,
  X,
  Plus,
  Info,
  Layers,
  FileText,
  FileVideo,
  Signal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { Toggle } from "../components/ui/Toggle";
import { CustomSelect } from "../components/ui/CustomSelect";
import { categoryForFile, downloadCategories } from "../domain/categories";
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
    payload?.preview?.fileName || "Breaking Bad Season 1 Complete 720p BRRip",
  );
  const [createSubfolder, setCreateSubfolder] = useState(true);
  const [autoStart, setAutoStart] = useState(true);
  const [verifyFiles, setVerifyFiles] = useState(true);
  const [sequentialDownload, setSequentialDownload] = useState(true);
  const [limitSpeed, setLimitSpeed] = useState(false);
  const [downloadLimit, setDownloadLimit] = useState("");
  const [uploadLimit, setUploadLimit] = useState("");
  const [priority, setPriority] = useState("Normal");
  const [selectedCategory, setSelectedCategory] = useState("Séries");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fileList, setFileList] = useState<TorrentFileNode[]>([]);

  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    if (payload?.url) {
      void service
        .parseTorrentInfo(payload.url)
        .then((meta) => {
          if (!active) return;
          const realName = meta.name && meta.name !== "Torrent Magnet" ? meta.name : (payload.preview?.fileName || "Torrent Download");
          setTorrentName(realName);
          setSelectedCategory(categoryForFile(realName, settings.customCategories));

          if (meta.files && meta.files.length > 0) {
            setFileList(
              meta.files.map((f, idx) => ({
                id: idx + 1,
                name: f.path || realName,
                size: f.size > 0 ? f.size : (meta.totalSize || 0),
                selected: true,
              }))
            );
          } else {
            setFileList([
              {
                id: 1,
                name: realName,
                size: meta.totalSize || payload.preview?.fileSize || 0,
                selected: true,
              },
            ]);
          }
        })
        .catch(() => {
          if (!active) return;
          const fallbackName = payload.preview?.fileName || "Torrent Download";
          setTorrentName(fallbackName);
          setFileList([
            {
              id: 1,
              name: fallbackName,
              size: payload.preview?.fileSize || 0,
              selected: true,
            },
          ]);
        });
    }
    return () => {
      active = false;
    };
  }, [payload, settings.customCategories]);

  useEffect(() => {
    void appWindow.setSize(new LogicalSize(760, 580)).catch(() => {});
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

  const categories = [
    ...downloadCategories.map((item) => item.name),
    ...settings.customCategories.map((item) => item.name),
  ];

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
        selectedCategory,
        true,
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
            <h1 data-tauri-drag-region className="text-truncate" style={{ maxWidth: 520 }}>
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
          {/* Card 1: Salvar em */}
          <div className="tc-card">
            <label className="tc-card-label">Salvar em</label>
            <div className="tc-path-row">
              <div className="tc-path-box">{destination}</div>
              <button type="button" className="tc-btn-outline" onClick={chooseFolder}>
                Alterar
              </button>
            </div>
            <div className="tc-toggle-inline">
              <Toggle checked={createSubfolder} onChange={setCreateSubfolder} />
              <span>Criar subpasta</span>
            </div>
          </div>

          {/* Nome do Torrent */}
          <div className="tc-card">
            <label className="tc-card-label">Nome do torrent</label>
            <input
              type="text"
              className="tc-input-name"
              value={torrentName}
              onChange={(e) => setTorrentName(e.target.value)}
            />
          </div>

          {/* Card 2: Opções do Torrent */}
          <div className="tc-card tc-options-card">
            <div className="tc-card-header">
              <Settings size={16} className="tc-icon-cyan" />
              <strong>Opções do torrent</strong>
            </div>

            <div className="tc-option-row">
              <Toggle checked={autoStart} onChange={setAutoStart} />
              <div>
                <strong>Iniciar download automaticamente</strong>
                <span>Inicia o download assim que o torrent for adicionado.</span>
              </div>
            </div>

            <div className="tc-option-row">
              <Toggle checked={verifyFiles} onChange={setVerifyFiles} />
              <div>
                <strong>Verificar arquivos ao adicionar</strong>
                <span>Verifica os dados dos arquivos antes de iniciar o download.</span>
              </div>
            </div>

            <div className="tc-select-row">
              <label>Prioridade</label>
              <div className="tc-select-box">
                <Signal size={14} />
                <CustomSelect
                  value={priority}
                  options={[
                    { value: "Baixa", label: "Baixa" },
                    { value: "Normal", label: "Normal" },
                    { value: "Alta", label: "Alta" },
                  ]}
                  onChange={setPriority}
                />
              </div>
            </div>

            <div className="tc-select-row">
              <label>Categoria</label>
              <div className="tc-select-box">
                <Folder size={14} />
                <CustomSelect
                  value={selectedCategory}
                  options={categories.map((c) => ({ value: c, label: c }))}
                  onChange={setSelectedCategory}
                />
              </div>
            </div>

            <div className="tc-option-row">
              <Toggle checked={sequentialDownload} onChange={setSequentialDownload} />
              <div>
                <strong>Baixar em sequência <Info size={12} className="tc-info-icon" /></strong>
                <span>Baixa os arquivos na ordem correta para reprodução.</span>
              </div>
            </div>

            <div className="tc-option-row">
              <Toggle checked={limitSpeed} onChange={setLimitSpeed} />
              <div>
                <strong>Limitar velocidade</strong>
                <span>Define um limite de velocidade global para este torrent.</span>
              </div>
            </div>

            {limitSpeed && (
              <div className="tc-speed-inputs">
                <div>
                  <label>Download</label>
                  <input
                    type="text"
                    placeholder="— KB/s"
                    value={downloadLimit}
                    onChange={(e) => setDownloadLimit(e.target.value)}
                  />
                </div>
                <div>
                  <label>Upload</label>
                  <input
                    type="text"
                    placeholder="— KB/s"
                    value={uploadLimit}
                    onChange={(e) => setUploadLimit(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Torrent Content */}
        <div className="tc-right-col">
          <div className="tc-card tc-content-card">
            <div className="tc-card-header">
              <FileText size={16} className="tc-icon-cyan" />
              <strong>Conteúdo do torrent</strong>
            </div>

            <div className="tc-stats-header">
              <div className="tc-stat-pair">
                <div>
                  <span className="tc-stat-label">Nome</span>
                  <strong className="tc-stat-val text-truncate">{torrentName}</strong>
                </div>
                <div className="text-right">
                  <span className="tc-stat-label">Espaço em disco</span>
                  <strong className="tc-stat-val">95,7 GB livre</strong>
                </div>
              </div>
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

            <div className="tc-actions-bar">
              <button type="button" className="tc-btn-outline" onClick={selectAll}>
                Selecionar tudo
              </button>
              <button type="button" className="tc-btn-dark" onClick={clearSelection}>
                Limpar seleção
              </button>
            </div>

            {/* Table / Tree view of files */}
            <div className="tc-table-wrap">
              <div className="tc-table-header-row">
                <span className="col-name">Nome ↓</span>
                <span className="col-size">Tamanho</span>
              </div>
              <div className="tc-table-body">
                {/* Folder Root */}
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

                {/* Child File Rows */}
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
            <span>Você pode alterar a seleção de arquivos antes de iniciar o download.</span>
          </div>
        </div>

        <div className="tc-footer-right">
          <button type="button" className="tc-btn-dark" onClick={close}>
            Cancelar
          </button>
          <button
            type="button"
            className="tc-btn-cyan-solid"
            onClick={finish}
            disabled={busy}
          >
            <Plus size={16} />
            <span>Adicionar torrent</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
