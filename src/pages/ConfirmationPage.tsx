import {
  Archive,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  LockKeyhole,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FileIcon } from "../components/downloads/FileIcon";
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

export function ConfirmationPage() {
  const payload = useMemo(() => {
      try {
        return JSON.parse(
          localStorage.getItem("sf-downloader.confirmation") || "",
        ) as Payload;
      } catch {
        return null;
      }
    }, []),
    appWindow = getCurrentWindow(),
    settings = useMemo(loadSettings, []);
  const [destination, setDestination] = useState(payload?.destination || ""),
    [preview, setPreview] = useState<service.DownloadPreview | null>(
      payload?.preview || null,
    ),
    [loading, setLoading] = useState(Boolean(payload && !payload.preview)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [autoExtract, setAutoExtract] = useState(false),
    [hasPassword, setHasPassword] = useState(false),
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
    supportsArchivePassword = ["zip", "7z", "rar"].includes(
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
  const chooseFolder = async () => {
    const path = await open({ directory: true });
    if (typeof path === "string") setDestination(path);
  };
  const finish = async () => {
    if (!preview) return;
    if (autoExtract && supportsArchivePassword && hasPassword && !password) {
      setError("Informe a senha usada para extrair o arquivo.");
      return;
    }
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
        supportsArchivePassword && hasPassword ? password : undefined,
        selectedCategory,
      );
      await emit("download-created", task);
      localStorage.removeItem("sf-downloader.confirmation");
      close();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  if (!payload)
    return (
      <main className="download-window">
        <header className="download-window-title" data-tauri-drag-region>
          <span>Confirmar download</span>
          <button onClick={close}>
            <X />
          </button>
        </header>
        <p className="window-error">Solicitação não encontrada.</p>
      </main>
    );
  return (
    <main className="download-window confirmation-compact">
      <header className="download-window-title" data-tauri-drag-region>
        <span>
          <Download />
          Confirmar download
        </span>
        <button onClick={close}>
          <X />
        </button>
      </header>
      <section className="download-window-content">
        <div className="window-file-summary">
          <FileIcon extension={preview?.extension ?? null} />
          <strong title={preview?.fileName}>
            {preview?.fileName ||
              (loading ? "Consultando arquivo..." : "Arquivo desconhecido")}
          </strong>
          <b>{loading ? "—" : bytes(preview?.fileSize ?? null)}</b>
        </div>
        <div className="compact-field-row">
          <span>
            <FolderOpen />
            Destino
          </span>
          <div className="destination-value" title={effectiveDestination}>
            {effectiveDestination || "Escolha uma pasta"}
          </div>
          <button onClick={chooseFolder}>Alterar</button>
        </div>
        <div className="compact-field-row">
          <span>
            <Archive />
            Categoria
          </span>
          <select
            className="category-select"
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
        <div className="window-options">
          <label className={`check-row ${!isArchive ? "disabled" : ""}`}>
            <input
              type="checkbox"
              checked={autoExtract}
              disabled={!isArchive}
              onChange={(event) => setAutoExtract(event.target.checked)}
            />
            <span>Extrair automaticamente após o download</span>
          </label>
          <label
            className={`password-row ${!autoExtract || !supportsArchivePassword ? "disabled" : ""}`}
          >
            <input
              type="checkbox"
              checked={hasPassword}
              disabled={!autoExtract || !supportsArchivePassword}
              onChange={(event) => setHasPassword(event.target.checked)}
            />
            <span>
              <LockKeyhole />
              Arquivo com senha
            </span>
            <div>
              <input
                type={showPassword ? "text" : "password"}
                disabled={!hasPassword}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Digite a senha"
              />
              <button
                disabled={!hasPassword}
                onClick={(event) => {
                  event.preventDefault();
                  setShowPassword((value) => !value);
                }}
              >
                {showPassword ? <EyeOff /> : <Eye />}
              </button>
            </div>
          </label>
        </div>
        {error && <p className="window-error">{error}</p>}
      </section>
      <footer className="download-window-actions">
        <button onClick={close}>Cancelar</button>
        <button
          className="primary"
          disabled={busy || loading || !preview}
          onClick={() => void finish()}
        >
          <Download />
          {busy ? "Iniciando..." : "Baixar"}
        </button>
      </footer>
    </main>
  );
}
