import {
  Archive,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  Globe,
  Info,
  LockKeyhole,
  Minus,
  Package,
  X,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { Toggle } from "../components/ui/Toggle";
import { categoryForFile, downloadCategories } from "../domain/categories";
import { loadSettings } from "../services/settingsStorage";
import * as service from "../services/downloadService";

interface Payload {
  url: string;
  destination: string;
  requestId?: string;
  preview?: service.DownloadPreview;
}

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

const shortHost = (value: string) => {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
};

const baseName = (value: string) => value.split(/[\\/]/).pop() || value;

const stripFileName = (message: string) =>
  message.replace(/^[^:]+:\s*/, "");

export function ConfirmationPage({ token }: { token: string }) {
  const storageKey = `sf-downloader.confirmation-${token}`;
  const payload = useMemo(() => {
    try {
      return JSON.parse(
        localStorage.getItem(storageKey) || "",
      ) as Payload;
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
  const [preview, setPreview] = useState<service.DownloadPreview | null>(
    payload?.preview || null,
  );
  const [loading, setLoading] = useState(Boolean(payload && !payload.preview));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [autoExtract, setAutoExtract] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("Outros");
  const [detailsOpen, setDetailsOpen] = useState(false);

  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!payload || payload.preview) return;
    let active = true;
    if (payload.url.startsWith("magnet:") || payload.url.toLowerCase().endsWith(".torrent")) {
      void service
        .parseTorrentInfo(payload.url)
        .then((meta) => {
          if (!active) return;
          setPreview({
            url: payload.url,
            fileName: meta.name,
            fileSize: meta.totalSize || null,
            mimeType: "application/x-bittorrent",
            extension: "torrent",
          });
        })
        .catch((cause) => active && setError(String(cause)))
        .finally(() => active && setLoading(false));
    } else {
      void service
        .inspectDownload(payload.url)
        .then((result) => active && setPreview(result))
        .catch((cause) => active && setError(String(cause)))
        .finally(() => active && setLoading(false));
    }
    return () => {
      active = false;
    };
  }, [payload]);

  useEffect(() => {
    if (preview) {
      setSelectedCategory(
        categoryForFile(preview.fileName, settings.customCategories),
      );
    }
  }, [preview, settings.customCategories]);

  useEffect(() => {
    let active = true;
    const fit = async () => {
      const root = mainRef.current;
      if (!root) return;
      await document.fonts?.ready.catch(() => {});
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (!active) return;
      const header = root.querySelector(".confirm-header") as HTMLElement | null;
      const body = root.querySelector(".confirm-body") as HTMLElement | null;
      const footer = root.querySelector(".confirm-footer") as HTMLElement | null;
      const headerH = header?.getBoundingClientRect().height || 46;
      const bodyH = body?.getBoundingClientRect().height || body?.scrollHeight || 190;
      const footerH = footer?.getBoundingClientRect().height || 50;
      const totalH = Math.ceil(headerH + bodyH + footerH);
      void appWindow
        .setSize(new LogicalSize(600, Math.max(295, Math.min(totalH, 480))))
        .catch(() => {});
    };
    void fit();
    return () => {
      active = false;
    };
  }, [loading, preview, error]);

  const close = () => void appWindow.close();
  const isArchive = ["zip", "7z", "rar", "tar", "gz", "tgz"].includes(
    preview?.extension?.toLowerCase() ?? "",
  );
  const categories = [
    ...downloadCategories.map((item) => item.name),
    ...settings.customCategories.map((item) => item.name),
  ];
  const isCustomFolder = destination.trim() !== "" && destination !== settings.rootDownloadFolder;

  const chooseFolder = async () => {
    const path = await open({ directory: true });
    if (typeof path === "string" && path.trim()) {
      setDestination(path);
      try {
        localStorage.setItem("sf-downloader.last-save-folder", path);
      } catch {}
    }
  };

  const restoreDefaultFolder = () => {
    setDestination(settings.rootDownloadFolder);
    try {
      localStorage.removeItem("sf-downloader.last-save-folder");
    } catch {}
  };

  const finish = async (force = false) => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const task = await service.startDownload(
        preview.url,
        isCustomFolder ? { ...settings, autoOrganizeEnabled: false } : settings,
        destination,
        payload?.requestId,
        true,
        autoExtract,
        isArchive && password.trim() ? password : undefined,
        isCustomFolder ? undefined : selectedCategory,
        force,
      );
      localStorage.removeItem(storageKey);
      setDuplicateOpen(false);
      close();
      void emit("download-created", task).catch(() => {});
    } catch (cause) {
      const message = String(cause);
      if (/já foi baixado/i.test(message)) {
        setDuplicateOpen(true);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  };

  const fileNameText = preview?.fileName
    ? baseName(preview.fileName)
    : loading
      ? "Consultando arquivo..."
      : "Confirmar download";

  const hostName = payload?.url ? shortHost(payload.url) : "";

  if (!payload)
    return (
      <main ref={mainRef} className="download-window confirm-v2">
        <header className="confirm-header" data-tauri-drag-region>
          <div className="confirm-header-left">
            <Download className="confirm-header-icon" size={20} />
            <span className="confirm-title" title="Confirmar download">
              Confirmar download
            </span>
          </div>
          <div className="confirm-window-controls nodrag">
            <button onClick={() => void appWindow.minimize()} title="Minimizar">
              <Minus size={16} />
            </button>
            <button onClick={close} title="Fechar">
              <X size={16} />
            </button>
          </div>
        </header>
        <p className="window-error confirm-empty">Solicitação não encontrada.</p>
      </main>
    );

  return (
    <main ref={mainRef} className="download-window confirm-v2">
      {/* 1. Header (Barra de título com nome do arquivo) */}
      <header className="confirm-header" data-tauri-drag-region>
        <div className="confirm-header-left">
          <Download className="confirm-header-icon" size={20} />
          <span className="confirm-title" title={fileNameText}>
            {fileNameText}
          </span>
        </div>
        <div className="confirm-window-controls nodrag">
          <button onClick={() => void appWindow.minimize()} title="Minimizar">
            <Minus size={16} />
          </button>
          <button onClick={close} title="Fechar">
            <X size={16} />
          </button>
        </div>
      </header>

      {/* 2. Conteúdo Central */}
      <div className="confirm-body">
        {/* Linha 1: Pílula Integrada de Metadados */}
        <div className="confirm-meta-row">
          <div className="confirm-meta-item item-origin" title={hostName || "Provedor desconhecido"}>
            <Globe size={16} />
            <span>{hostName || "origem desconhecida"}</span>
          </div>
          <div className="confirm-meta-item item-size">
            <Package size={16} />
            <span>{loading ? "Calculando..." : bytes(preview?.fileSize ?? null)}</span>
          </div>
          <div className="confirm-meta-item item-type">
            <FileText size={16} />
            <span>{(preview?.extension || "ARQUIVO").toUpperCase()}</span>
          </div>
        </div>

        {/* Linha 2: Local e Categoria em 2 Colunas */}
        <div className="confirm-grid-row">
          <div className="confirm-field-col">
            <div className="confirm-label-row">
              <span className="confirm-label">Local</span>
              {destination !== settings.rootDownloadFolder && (
                <button
                  type="button"
                  className="confirm-btn-reset-default"
                  onClick={restoreDefaultFolder}
                  title="Voltar para a pasta padrão configurada no aplicativo"
                >
                  <RotateCcw size={12} />
                  <span>Voltar ao padrão</span>
                </button>
              )}
            </div>
            <div className="confirm-control-box">
              <FolderOpen className="field-icon" size={16} />
              <input
                className="confirm-input-text"
                value={destination || ""}
                placeholder="Selecione uma pasta"
                readOnly
              />
              <button className="confirm-btn-alterar" onClick={chooseFolder}>
                Alterar
              </button>
            </div>
          </div>

          <div className={`confirm-field-col${isCustomFolder ? " confirm-field-disabled" : ""}`}>
            <span className="confirm-label">Categoria</span>
            <div className="confirm-control-box">
              <Archive className="field-icon" size={16} />
              <select
                className="confirm-select"
                value={isCustomFolder ? "" : selectedCategory}
                onChange={(event) => setSelectedCategory(event.target.value)}
                disabled={isCustomFolder}
              >
                {isCustomFolder ? (
                  <option value="">Pasta personalizada</option>
                ) : (
                  categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))
                )}
              </select>
              <ChevronDown className="select-arrow" size={14} />
            </div>
          </div>
        </div>

        {/* Linha 3: Extrair e Senha em 2 Colunas */}
        <div className="confirm-grid-row">
          <div className="confirm-control-box box-toggle">
            <Toggle
              label="Extrair após concluir"
              checked={isArchive && autoExtract}
              onChange={setAutoExtract}
              disabled={!isArchive}
            />
            <span className="toggle-label">Extrair após concluir</span>
          </div>

          <div className={`confirm-control-box box-password ${autoExtract ? "" : "is-disabled"}`}>
            <LockKeyhole className="field-icon" size={16} />
            <input
              className="confirm-input-text"
              type={showPassword ? "text" : "password"}
              value={password}
              disabled={!autoExtract}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Digite a senha (opcional)"
            />
            <button
              type="button"
              className="confirm-btn-eye"
              onClick={() => setShowPassword((value) => !value)}
              disabled={!autoExtract}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* 3. Rodapé Fixo */}
      {!error && (
        <footer className="confirm-footer">
          <button
            className="confirm-details-toggle"
            onClick={() => setDetailsOpen((v) => !v)}
          >
            <ChevronDown className={detailsOpen ? "is-open" : ""} size={16} />
            <span>Mais detalhes</span>
          </button>

          <div className="confirm-footer-actions">
            <button className="confirm-btn-cancel" onClick={close}>
              Cancelar
            </button>
            <button
              className="confirm-btn-start"
              disabled={busy || loading || !preview}
              onClick={() => void finish()}
            >
              <Download size={18} />
              <span>{busy ? "Iniciando..." : "Iniciar download"}</span>
            </button>
          </div>
        </footer>
      )}

      {/* Painel Deslizante de Mais Detalhes (Idêntico às outras janelas) */}
      {detailsOpen && (
        <div className="dw-details confirm-details-sheet">
          <p className="dw-details-title">Detalhes técnicos</p>
          <div className="dw-detail-row">
            <span>URL Completa</span>
            <b title={payload.url}>{payload.url}</b>
          </div>
          <div className="dw-detail-row">
            <span>Provedor / Servidor</span>
            <b>{hostName || "—"}</b>
          </div>
          <div className="dw-detail-row">
            <span>Tipo MIME</span>
            <b>{preview?.mimeType || "Desconhecido"}</b>
          </div>
          <div className="dw-detail-row">
            <span>Tamanho Exato</span>
            <b>{preview?.fileSize ? `${preview.fileSize.toLocaleString()} bytes` : "—"}</b>
          </div>
          <div className="dw-detail-row">
            <span>Extensão</span>
            <b>{preview?.extension?.toUpperCase() || "N/A"}</b>
          </div>
          <div className="dw-detail-row">
            <span>Pasta de Destino</span>
            <b title={destination}>{destination || "—"}</b>
          </div>
        </div>
      )}

      {error && (
        <div className="confirm-error-sheet">
          <div className="confirm-error-header">
            <div className="confirm-error-icon">
              <AlertTriangle />
            </div>
            <div className="confirm-error-text">
              <p className="confirm-error-title">Erro ao iniciar download</p>
              <p className="confirm-error-message">{stripFileName(error)}</p>
            </div>
          </div>
          <div className="confirm-error-sep" />
          <div className="confirm-error-actions">
            <button className="confirm-error-btn" onClick={() => setError(null)}>
              Voltar
            </button>
          </div>
        </div>
      )}

      {duplicateOpen && (
        <div className="confirm-duplicate-overlay">
          <section className="confirm-duplicate-dialog">
            <header>
              <AlertTriangle />
              <span>Download já realizado</span>
            </header>
            <p>Este arquivo já foi baixado uma vez.</p>
            <footer>
              <button disabled={busy} onClick={() => void finish(true)}>
                Baixar novamente
              </button>
              <button
                className="confirm-duplicate-cancel"
                onClick={() => setDuplicateOpen(false)}
              >
                Cancelar
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
