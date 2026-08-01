import {
  Download,
  FolderOpen,
  X,
  Plus,
  Layers,
  FileText,
  FileVideo,
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
  return `${size.toFixed(index >= 3 ? 2 : index ? 1 : 0)} ${units[index]} (${value.toLocaleString("pt-BR")} bytes)`;
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

      setError(null); // Remover mensagem de erro imediatamente apos sucesso
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
      console.log("[TORRENT_LOG][FRONTEND_STATE] Estado atualizado para ready com arquivos reais:", nodes);
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

      // Listener assincrono com cleanup estrito (StrictMode safe)
      const unlistenPromise = listen<TorrentMetadataResponse>(
        `torrent-metadata-ready-${token}`,
        (event) => {
          if (!active) return;
          const p = event.payload;

          // Log obrigatorio solicitado no passo 8
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
    if (status === "fetchingMetadata") {
      console.log("[MAGNET_CANCELLED] Cancelando busca de metadados pelo usuário.");
      setStatus("cancelled");
    }
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
    if (!payload?.url || status !== "ready") return;
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

      {/* Exibir banner de erro apenas se no estado failed */}
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
                      <strong className="tc-stat-val text-truncate" style={{ maxWidth: 220 }}>
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
                {/* Tamanho selecionado e Total */}
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

      {/* Footer */}
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
                ? `${selectedCount} de ${totalFilesCount} arquivos selecionados • ${bytes(selectedSize)}`
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
            disabled={busy || status !== "ready" || !!error || fileList.length === 0 || selectedCount === 0}
          >
            <Plus size={16} />
            <span>Adicionar torrent</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
