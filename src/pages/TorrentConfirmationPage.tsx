import {
  Download,
  FolderOpen,
  X,
  Plus,
  Layers,
  FileText,
  FileVideo,
  FileAudio,
  FileArchive,
  Disc,
  File,
  Loader2,
  Clock,
  Key,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { Toggle } from "../components/ui/Toggle";
import { loadSettings } from "../services/settingsStorage";
import * as service from "../services/downloadService";
import type { TorrentMetadataResponse } from "../services/downloadService";

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

type PageStatus = "idle" | "fetchingMetadata" | "ready" | "failed" | "cancelled";

export const formatFileSize = (value: number | null | undefined): string => {
  if (value === null || value === undefined || value < 0) return "Desconhecido";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const size = value / Math.pow(1024, index);
  return `${size.toLocaleString("pt-BR", {
    minimumFractionDigits: index >= 3 ? 2 : index ? 1 : 0,
    maximumFractionDigits: 2,
  })} ${units[index]}`;
};

function getFileItemIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (["iso", "img", "nrg", "vcd"].includes(ext)) {
    return <Disc size={14} className="tc-file-icon" style={{ color: "#a855f7" }} />;
  }
  if (["mkv", "mp4", "avi", "mov", "wmv", "flv", "webm"].includes(ext)) {
    return <FileVideo size={14} className="tc-file-icon" style={{ color: "#3b82f6" }} />;
  }
  if (["mp3", "flac", "wav", "aac", "ogg", "m4a"].includes(ext)) {
    return <FileAudio size={14} className="tc-file-icon" style={{ color: "#ec4899" }} />;
  }
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(ext)) {
    return <FileArchive size={14} className="tc-file-icon" style={{ color: "#f59e0b" }} />;
  }
  if (["txt", "nfo", "md", "doc", "docx", "pdf", "sfv", "info"].includes(ext)) {
    return <FileText size={14} className="tc-file-icon" style={{ color: "#10b981" }} />;
  }
  return <File size={14} className="tc-file-icon" style={{ color: "var(--text-2)" }} />;
}

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

  const [status, setStatus] = useState<PageStatus>("idle");
  const [infoHash, setInfoHash] = useState<string>("");
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [fileList, setFileList] = useState<TorrentFileNode[]>([]);

  const mainRef = useRef<HTMLDivElement>(null);

  // Timer para tempo decorrido no fetchingMetadata
  useEffect(() => {
    if (status !== "fetchingMetadata") return;
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

  const handleMetadataResponse = (res: TorrentMetadataResponse) => {
    console.log("[TORRENT_LOG][FRONTEND_STATE] Recebida resposta de metadados:", res);

    if (res.status === "fetchingMetadata") {
      setStatus("fetchingMetadata");
      setError(null);
      setInfoHash(res.infoHash || (res as any).info_hash || "");
      if (res.name) setTorrentName(res.name);
      setFileList([]);
    } else if (res.status === "ready") {
      const rawTotalSize = res.totalSize ?? (res as any).total_size ?? 0;
      const rawFiles = res.files ?? (res as any).files ?? [];

      if (!rawFiles || rawFiles.length === 0 || !rawTotalSize || rawTotalSize === 0) {
        setError("Não foi possível ler os metadados deste torrent.");
        setStatus("failed");
        setFileList([]);
        return;
      }

      setError(null);
      setStatus("ready");
      setTorrentName(res.name);
      setInfoHash(res.infoHash || (res as any).info_hash || "");

      const nodes: TorrentFileNode[] = rawFiles.map((f: any, idx: number) => ({
        id: idx + 1,
        name: f.path,
        size: f.size > 0 ? f.size : rawTotalSize,
        selected: true,
      }));
      setFileList(nodes);
    }
  };

  useEffect(() => {
    let active = true;
    if (payload?.url) {
      setError(null);
      setStatus("fetchingMetadata");

      void service
        .parseTorrentInfo(payload.url, token)
        .then((res) => {
          if (!active) return;
          handleMetadataResponse(res);
        })
        .catch((err) => {
          if (!active) return;
          console.error("[TORRENT_LOG][FRONTEND_STATE] Falha ao obter metadados:", err);
          setError("Não foi possível ler os metadados deste torrent.");
          setStatus("failed");
          setFileList([]);
        });

      const unlistenPromise = listen<TorrentMetadataResponse>(
        `torrent-metadata-ready-${token}`,
        (event) => {
          if (!active) return;
          const p = event.payload;
          console.log(
            JSON.stringify(
              {
                status: p.status,
                totalSize: (p as any).totalSize,
                total_size: (p as any).total_size,
                files: (p as any).files,
                errorBeforeUpdate: error,
                currentStatus: status,
              },
              null,
              2,
            ),
          );
          handleMetadataResponse(p);
        },
      );

      return () => {
        active = false;
        void unlistenPromise.then((unlisten) => unlisten());
      };
    }
  }, [payload, token]);

  useEffect(() => {
    void appWindow.setSize(new LogicalSize(740, 520)).catch(() => {});
  }, [appWindow]);

  const close = () => {
    if (infoHash) {
      console.log("[MAGNET_CANCELLED] Cancelando busca/torrent pelo infoHash:", infoHash);
      void service.cancelTorrent(infoHash, false).catch(() => {});
    }
    setStatus("cancelled");
    void appWindow.close();
  };

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

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const finish = async () => {
    if (!payload?.url || status !== "ready" || !infoHash) return;
    setBusy(true);
    setError(null);
    try {
      const task = await service.confirmTorrent({
        infoHash,
        savePath: destination,
        selectedFileIndexes: selectedFiles.map((f) => f.id - 1),
        startImmediately: autoStart,
      });
      localStorage.removeItem(storageKey);
      void emit("download-created", task).catch(() => {});
      await service.openTorrentProgressWindow(infoHash, task.id);
      void appWindow.close();
    } catch (cause) {
      console.error("[ADD_TORRENT_ALERT] Erro ao confirmar torrent:", cause);
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
            <h1 data-tauri-drag-region className="text-truncate" style={{ maxWidth: 500 }} title={torrentName}>
              {torrentName}
            </h1>
            <p data-tauri-drag-region>Adicionar Torrent • Configure seu download antes de iniciar.</p>
          </div>
        </div>
        <button type="button" className="tc-close-btn" onClick={close}>
          <X size={18} />
        </button>
      </header>

      {status === "failed" && error && <div className="tc-error-banner">{error}</div>}

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
              title={torrentName}
            />
          </div>

          {/* 2. Pasta de destino + Alterar */}
          <div className="tc-card">
            <label className="tc-card-label">Salvar em</label>
            <div className="tc-path-row">
              <div className="tc-path-box" title={destination}>{destination}</div>
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

            {status === "fetchingMetadata" && (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                  padding: 24,
                  textAlign: "center",
                  background: "rgba(0, 0, 0, 0.25)",
                  borderRadius: 10,
                  border: "1px solid var(--line, rgba(255, 255, 255, 0.08))",
                }}
              >
                <Loader2 size={36} className="animate-spin" style={{ color: "var(--ember-solid)" }} />
                <div>
                  <strong style={{ fontSize: 13, color: "#ffffff", display: "block" }}>
                    Obtendo metadados do torrent…
                  </strong>
                  <span style={{ fontSize: 11, color: "var(--text-2)", marginTop: 4, display: "block" }}>
                    Conectando aos pares da rede P2P BitTorrent para ler a estrutura de arquivos.
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", marginTop: 8 }}>
                  {infoHash && (
                    <div className="tc-stat-pair" style={{ justifyContent: "center", gap: 6 }}>
                      <Key size={12} style={{ color: "var(--text-2)" }} />
                      <span className="tc-stat-label">Info Hash:</span>
                      <strong className="tc-stat-val text-truncate" style={{ maxWidth: 220 }} title={infoHash}>
                        {infoHash}
                      </strong>
                    </div>
                  )}

                  <div className="tc-stat-pair" style={{ justifyContent: "center", gap: 6 }}>
                    <Clock size={12} style={{ color: "var(--text-2)" }} />
                    <span className="tc-stat-label">Tempo decorrido:</span>
                    <strong className="tc-stat-val">{formatTime(elapsedSeconds)}</strong>
                  </div>
                </div>
              </div>
            )}

            {status === "ready" && (
              <>
                {/* 1. Resumo Superior com Duas Colunas Responsivas */}
                <div className="tc-stats-header">
                  <div className="tc-stat-pair">
                    <div>
                      <span className="tc-stat-label">Tamanho total</span>
                      <strong className="tc-stat-val" title={`${totalSize.toLocaleString("pt-BR")} bytes`}>
                        {formatFileSize(totalSize)}
                      </strong>
                    </div>
                    <div className="text-right">
                      <span className="tc-stat-label">Selecionados</span>
                      <strong className="tc-stat-val" title={`${selectedSize.toLocaleString("pt-BR")} bytes`}>
                        {selectedCount} de {totalFilesCount} · {formatFileSize(selectedSize)}
                      </strong>
                    </div>
                  </div>
                </div>

                {/* Botões de Seleção */}
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
                    <span className="col-name">Nome</span>
                    <span className="col-size">Tamanho</span>
                  </div>
                  <div className="tc-table-body">
                    {fileList.length === 1 ? (
                      /* Torrent de Arquivo Único: Apenas 1 linha real sem pasta fictícia */
                      <div key={fileList[0].id} className="tc-file-row single-file">
                        <input
                          type="checkbox"
                          checked={fileList[0].selected}
                          onChange={() => toggleFile(fileList[0].id)}
                        />
                        {getFileItemIcon(fileList[0].name)}
                        <span className="tc-file-name" title={fileList[0].name}>
                          {fileList[0].name}
                        </span>
                        <span className="tc-file-size" title={`${fileList[0].size.toLocaleString("pt-BR")} bytes`}>
                          {formatFileSize(fileList[0].size)}
                        </span>
                      </div>
                    ) : (
                      /* Torrent Multi-arquivo: Pasta Raiz + Arquivos Filhos */
                      <>
                        <div className="tc-file-row folder-root">
                          <input
                            type="checkbox"
                            checked={selectedCount === totalFilesCount}
                            onChange={(e) => (e.target.checked ? selectAll() : clearSelection())}
                          />
                          <FolderOpen size={14} className="tc-folder-icon" />
                          <span className="tc-file-name" title={torrentName}>{torrentName}</span>
                          <span className="tc-file-size" title={`${totalSize.toLocaleString("pt-BR")} bytes`}>
                            {formatFileSize(totalSize)}
                          </span>
                        </div>

                        {fileList.map((f) => (
                          <div key={f.id} className="tc-file-row child">
                            <input
                              type="checkbox"
                              checked={f.selected}
                              onChange={() => toggleFile(f.id)}
                            />
                            {getFileItemIcon(f.name)}
                            <span className="tc-file-name" title={f.name}>{f.name}</span>
                            <span className="tc-file-size" title={`${f.size.toLocaleString("pt-BR")} bytes`}>
                              {formatFileSize(f.size)}
                            </span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              </>
            )}

            {status === "failed" && (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 24,
                  textAlign: "center",
                }}
              >
                <span style={{ fontSize: 13, color: "var(--text-2)" }}>
                  Não foi possível ler os metadados deste torrent.
                </span>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer Simplificado */}
      <footer className="tc-footer">
        <div className="tc-footer-left">
          <div className="tc-layers-icon-box">
            <Layers size={18} />
          </div>
          <div>
            <strong>
              {status === "fetchingMetadata"
                ? "Obtendo metadados P2P..."
                : status === "ready"
                ? `${selectedCount} arquivo${selectedCount !== 1 ? "s" : ""} selecionado${selectedCount !== 1 ? "s" : ""} · ${formatFileSize(selectedSize)}`
                : "Erro nos metadados"}
            </strong>
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
            disabled={busy || status !== "ready" || !!error || totalSize === 0 || fileList.length === 0 || selectedCount === 0}
          >
            <Plus size={16} />
            <span>Adicionar torrent</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
