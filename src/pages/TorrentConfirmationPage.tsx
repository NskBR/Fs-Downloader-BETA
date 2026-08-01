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

  // Lista de arquivos internos do Torrent (fidelidade a foto de referencia 1)
  const initialFiles: TorrentFileNode[] = useMemo(() => [
    { id: 1, name: "Breaking Bad S01E01 - Pilot.mkv", size: 1567670272, selected: true },
    { id: 2, name: "Breaking Bad S01E02 - Cat's in the Bag.mkv", size: 1449551462, selected: true },
    { id: 3, name: "Breaking Bad S01E03 - ...And the Bag's in the River.mkv", size: 1428160512, selected: true },
    { id: 4, name: "Breaking Bad S01E04 - Cancer Man.mkv", size: 1471012864, selected: true },
    { id: 5, name: "Breaking Bad S01E05 - Gray Matter.mkv", size: 1395864371, selected: true },
    { id: 6, name: "Breaking Bad S01E06 - Crazy Handful of Nothin'.mkv", size: 1374389534, selected: true },
    { id: 7, name: "Breaking Bad S01E07 - A No-Rough-Stuff Type Deal.mkv", size: 1309965516, selected: true },
    { id: 8, name: "Breaking Bad S01E08 - Hermanos.mkv", size: 1309965516, selected: false },
    { id: 9, name: "Breaking Bad S01E09 - Bug.mkv", size: 1331439861, selected: true },
    { id: 10, name: "Breaking Bad S01E10 - ...And the Bag's in the River.mkv", size: 1181116006, selected: false },
    { id: 11, name: "sample.nfo", size: 6451, selected: true },
    { id: 12, name: "poster.jpg", size: 335872, selected: false },
  ], []);

  const [fileList, setFileList] = useState<TorrentFileNode[]>(initialFiles);

  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    if (payload?.url) {
      void service
        .parseTorrentInfo(payload.url)
        .then((meta) => {
          if (!active) return;
          if (meta.name && meta.name !== "Torrent Magnet") {
            setTorrentName(meta.name);
            setSelectedCategory(categoryForFile(meta.name, settings.customCategories));
          }
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [payload, settings.customCategories]);

  useEffect(() => {
    void appWindow.setSize(new LogicalSize(740, 570)).catch(() => {});
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
      {/* Header */}
      <header className="tc-header">
        <div className="tc-header-title">
          <div className="tc-header-icon-box">
            <Download size={18} />
          </div>
          <div>
            <h1>Adicionar Torrent</h1>
            <p>Configure seu download antes de iniciar.</p>
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
