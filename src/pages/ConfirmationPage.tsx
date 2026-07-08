import {
  Archive,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  LockKeyhole,
  Minus,
  X,
  Link2,
  AlertTriangle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { FileIcon } from "../components/downloads/FileIcon";
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
    }, [storageKey]),
    appWindow = getCurrentWindow(),
    settings = useMemo(loadSettings, []);
  const [destination, setDestination] = useState(payload?.destination || ""),
    [preview, setPreview] = useState<service.DownloadPreview | null>(
      payload?.preview || null,
    ),
    [loading, setLoading] = useState(Boolean(payload && !payload.preview)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [duplicateOpen, setDuplicateOpen] = useState(false),
    [autoExtract, setAutoExtract] = useState(false),
    [password, setPassword] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [selectedCategory, setSelectedCategory] = useState("Outros");
  useEffect(() => {
    if (!payload || payload.preview) return;
    let active = true;
    void service
      .inspectDownload(payload.url)
      .then((result) => active && setPreview(result))
      .catch((cause) => active && setError(String(cause)))
      .finally(() => active && setLoading(false));
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

  const close = () => void appWindow.close(),
    isArchive = ["zip", "7z", "rar", "tar", "gz", "tgz"].includes(
      preview?.extension?.toLowerCase() ?? "",
    ),
    categories = [
      ...downloadCategories.map((item) => item.name),
      ...settings.customCategories.map((item) => item.name),
    ],
    destinationSeparator = destination.includes("\\") ? "\\" : "/",
    effectiveDestination = destination
      ? `${destination.replace(/[\\/]$/, "")}${destinationSeparator}${selectedCategory}`
      : "";
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const fit = () => {
      const root = mainRef.current;
      if (!root) return;
      let total = 0;
      root.childNodes.forEach((node) => {
        if (node instanceof HTMLElement) total += node.offsetHeight;
      });
      void appWindow
        .setSize(new LogicalSize(600, total + 40))
        .catch(() => {});
    };
    fit();
    const frame = requestAnimationFrame(fit);
    const timer = window.setTimeout(fit, 120);
    document.fonts?.ready.then(fit).catch(() => {});
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [destination, error, preview, loading]);

  const chooseFolder = async () => {
    const path = await open({ directory: true });
    if (typeof path === "string") setDestination(path);
  };
  const finish = async (force = false) => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const task = await service.startDownload(
        preview.url,
        settings,
        destination,
        payload?.requestId,
        true,
        autoExtract,
        isArchive && password.trim() ? password : undefined,
        selectedCategory,
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
  if (!payload)
    return (
      <main ref={mainRef} className="download-window confirm-v2">
        <header className="confirm-header" data-tauri-drag-region>
          <div className="confirm-header-left">
            <Download size={32} />
            <span className="confirm-title">Confirmar download</span>
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
  const hostName = payload?.url ? shortHost(payload.url) : "";
  return (
    <main ref={mainRef} className="download-window confirm-v2">
      <header className="confirm-header" data-tauri-drag-region>
        <div className="confirm-header-left">
          <Download size={32} />
          <span className="confirm-title">Confirmar download</span>
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

      <section className="download-window-content confirm-content">
        <div className="confirm-hero">
          <div className="confirm-file-icon">
            <FileIcon extension={preview?.extension ?? null} />
          </div>
          <div className="confirm-hero-text">
            <strong className="confirm-file-name" title={preview?.fileName}>
              {preview?.fileName
                ? baseName(preview.fileName)
                : loading
                  ? "Consultando arquivo..."
                  : "Arquivo desconhecido"}
            </strong>
            <div className="confirm-meta">
              <span>{loading ? "Tamanho desconhecido" : bytes(preview?.fileSize ?? null)}</span>
              {preview?.extension && (
                <span className="confirm-meta-sep">•</span>
              )}
              {preview?.extension && (
                <span>{preview.extension.toUpperCase()}</span>
              )}
              {hostName && <span className="confirm-meta-sep">•</span>}
              {hostName && <span>{hostName}</span>}
            </div>
          </div>
        </div>

        <div className="confirm-divider-inset" />

        <div className="confirm-columns">
          <div className="confirm-col">
            <span className="confirm-field-label">
              <FolderOpen size={14} /> Local
            </span>
            <div className="confirm-location">
              <input
                className="confirm-location-input"
                value={destination || ""}
                placeholder="Selecione uma pasta"
                readOnly
              />
              <button className="confirm-change-btn" onClick={chooseFolder}>
                Alterar
              </button>
            </div>
          </div>

          <div className="confirm-col">
            <span className="confirm-field-label">
              <Archive size={14} /> Categoria
            </span>
            <select
              className="confirm-category"
              value={selectedCategory}
              onChange={(event) => setSelectedCategory(event.target.value)}
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={`confirm-extract ${isArchive ? "" : "confirm-extract--disabled"}`}>
          <div className="confirm-extract-row">
            <label className="confirm-extract-toggle">
              <Toggle checked={isArchive && autoExtract} onChange={setAutoExtract} label="Extrair arquivo" disabled={!isArchive} />
              <span>Extrair arquivo</span>
            </label>
            <div className={`confirm-password ${autoExtract ? "" : "is-dim"} ${isArchive ? "" : "confirm-password--hidden"}`}>
              <input
                className="confirm-password-input"
                type={showPassword ? "text" : "password"}
                value={password}
                disabled={!autoExtract}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Senha ( Opcional )"
              />
              <button
                type="button"
                className="confirm-password-toggle"
                onClick={() => setShowPassword((value) => !value)}
                disabled={!autoExtract}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        </div>

        {error && <p className="window-error">{error}</p>}
        <div className="confirm-divider-inset" />
      </section>

      <footer className="confirm-footer">
        <button className="confirm-cancel" onClick={close}>
          Cancelar
        </button>
        <button
          className="confirm-start"
          disabled={busy || loading || !preview}
          onClick={() => void finish()}
        >
          <Download size={18} />
          {busy ? "Iniciando..." : "Iniciar download"}
        </button>
      </footer>

      {duplicateOpen && (
        <div className="confirm-duplicate-overlay">
          <section className="confirm-duplicate-dialog">
            <header>
              <AlertTriangle />
              <span>Download já realizado</span>
            </header>
            <p>Este arquivo já foi baixado uma vez.</p>
            <footer>
              <button
                disabled={busy}
                onClick={() => void finish(true)}
              >
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
