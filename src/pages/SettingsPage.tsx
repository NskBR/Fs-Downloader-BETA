import { Plus, Tags, Trash2, Globe } from "lucide-react";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppLanguage, AppSettings, AccentColor, AppColor } from "../domain/settings";
import { downloadCategories } from "../domain/categories";
import {
  chooseDownloadFolder,
  createCategoryFolders,
} from "../services/folderService";
import { Toggle } from "../components/ui/Toggle";

interface Props {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  saved: boolean;
  onBack: () => void;
}

export function SettingsPage({ settings, onSave, saved }: Props) {
  const [draft, setDraft] = useState(settings),
    [error, setError] = useState<string | null>(null),
    [categoryName, setCategoryName] = useState(""),
    [categoryExtensions, setCategoryExtensions] = useState("");
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    if (next.rootDownloadFolder.trim())
      void save(next);
    else setError("Escolha a pasta principal de downloads.");
  };
  const save = async (next: AppSettings) => {
    setError(null);
    try {
      if (next.autoOrganizeEnabled)
        await createCategoryFolders(
          next.rootDownloadFolder,
          next.customCategories.map((category) => category.name),
        );
      onSave({ ...next, theme: settings.theme });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar as configurações.",
      );
    }
  };
  const openBrowserIntegration = () => {
    void invoke("open_browser_integration_window").catch(console.error);
  };
  const selectFolder = async () => {
    setError(null);
    try {
      const folder = await chooseDownloadFolder();
      if (folder) update("rootDownloadFolder", folder);
    } catch {
      setError("Não foi possível abrir o seletor de pastas.");
    }
  };
  const addCategory = () => {
    const name = categoryName.trim();
    if (!name || /[<>:"/\\|?*]/.test(name) || name === "." || name === "..") {
      setError(
        "Informe um nome de categoria válido, sem caracteres de caminho.",
      );
      return;
    }
    const names = [
      ...downloadCategories.map((category) => category.name),
      ...draft.customCategories.map((category) => category.name),
    ];
    if (names.some((current) => current.toLowerCase() === name.toLowerCase())) {
      setError("Já existe uma categoria com esse nome.");
      return;
    }
    const extensions = [
      ...new Set(
        categoryExtensions
          .split(/[\s,;]+/)
          .map((extension) => extension.replace(/^\./, "").toLowerCase())
          .filter((extension) => /^[a-z0-9]+$/.test(extension)),
      ),
    ];
    update("customCategories", [
      ...draft.customCategories,
      { id: crypto.randomUUID(), name, extensions },
    ]);
    setCategoryName("");
    setCategoryExtensions("");
    setError(null);
  };
  const removeCategory = (id: string) =>
    update(
      "customCategories",
      draft.customCategories.filter((category) => category.id !== id),
    );
  return (
    <section className="simple-settings">
      <header>
        <div>
          <h1>Configurações</h1>
          <p>Somente o essencial para usar o SF Downloader.</p>
        </div>
        {saved && <span className="settings-autosave">Salvo automaticamente</span>}
      </header>
      {error && <div className="error-banner">{error}</div>}

      <div className="simple-settings-list">
        <div className="setting-section">
          <h2>Geral</h2>
        </div>

        <div className="setting-item">
          <label>Cor de destaque</label>
          <span className="description">
            Define a cor do acento usada em botões, progresso e destaques do aplicativo.
          </span>
          <div className="accent-swatches">
            {(["ember","amber","green","red","blue","violet"] as AccentColor[]).map((key) => (
              <button
                key={key}
                type="button"
                className={`accent-swatch ${draft.accentColor === key ? "active" : ""}`}
                style={{ ["--swatch" as string]: `var(--accent-${key})` }}
                onClick={() => update("accentColor", key)}
                aria-label={key}
                title={key}
              />
            ))}
          </div>
        </div>

        <div className="setting-item">
          <label>Cor do aplicativo</label>
          <span className="description">
            Define a paleta base (fundo, painéis e superfícies). Combine com a cor de destaque.
          </span>
          <div className="accent-swatches">
            {(["slate","graphite","obsidian","mint","ocean","rose"] as AppColor[]).map((key) => (
              <button
                key={key}
                type="button"
                className={`appcolor-swatch ${draft.appColor === key ? "active" : ""}`}
                style={{
                  ["--swatch" as string]: `var(--appcolor-${key})`,
                  ["--swatch-2" as string]: `var(--appcolor-2-${key})`,
                }}
                onClick={() => update("appColor", key)}
                aria-label={key}
                title={key}
              />
            ))}
          </div>
        </div>

        <div className="setting-item">
          <label htmlFor="language-select">Idioma da interface</label>
          <span className="description">
            Define o idioma usado nos textos do aplicativo.
          </span>
          <select
            id="language-select"
            value={draft.language}
            onChange={(event) =>
              update("language", event.target.value as AppLanguage)
            }
          >
            <option value="pt-BR">Português (Brasil)</option>
            <option value="en-US">English (em preparação)</option>
          </select>
        </div>

        <div className="setting-item setting-item--toggle">
          <div>
            <label>Inicializar em tray mode</label>
            <span className="description">
              Inicia o SF Downloader oculto na bandeja do sistema.
            </span>
          </div>
          <Toggle
            checked={draft.startInTrayMode}
            onChange={(value) => update("startInTrayMode", value)}
            label="Inicializar em tray mode"
          />
        </div>

        <div className="setting-item">
          <label>Local padrão dos arquivos</label>
          <span className="description">
            Downloads e categorias serão armazenados a partir desta pasta.
          </span>
          {draft.rootDownloadFolder && (
            <div className="path-display" title={draft.rootDownloadFolder}>
              {draft.rootDownloadFolder}
            </div>
          )}
          <button className="flat-link-btn" onClick={selectFolder}>
            Alterar pasta de destino
          </button>
        </div>

        <div className="setting-section">
          <h2>Categorias personalizadas</h2>
        </div>
        <div className="setting-item custom-category-editor">
          <label>Criar categoria</label>
          <span className="description">
            A pasta será criada dentro do local padrão. As extensões são
            opcionais e servem para detecção automática.
          </span>
          <div className="category-create-row">
            <input
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
              placeholder="Nome, por exemplo: Jogos"
              maxLength={60}
            />
            <input
              value={categoryExtensions}
              onChange={(event) => setCategoryExtensions(event.target.value)}
              placeholder="Extensões: iso, rom, pkg"
            />
            <button onClick={addCategory} disabled={!categoryName.trim()}>
              <Plus />
              Adicionar
            </button>
          </div>
          <div className="custom-category-list">
            {draft.customCategories.length === 0 ? (
              <p>Nenhuma categoria personalizada.</p>
            ) : (
              draft.customCategories.map((category) => (
                <article key={category.id}>
                  <Tags />
                  <div>
                    <strong>{category.name}</strong>
                    <span>
                      {category.extensions.length
                        ? category.extensions
                            .map((extension) => `.${extension}`)
                            .join(", ")
                        : "Sem extensões automáticas"}
                    </span>
                  </div>
                  <button
                    title="Remover categoria"
                    onClick={() => removeCategory(category.id)}
                  >
                    <Trash2 />
                  </button>
                </article>
              ))
            )}
          </div>
        </div>

        <div className="setting-section">
          <h2>Integração</h2>
        </div>
        <div className="setting-item">
          <label>Extensão de Navegador</label>
          <span className="description">
            Instale a extensão do SF Downloader para capturar e gerenciar downloads diretamente nos navegadores Chromium (Chrome, Edge, Opera, Brave, Vivaldi) e Firefox.
          </span>
          <button className="flat-link-btn" onClick={openBrowserIntegration} style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "8px" }}>
            <Globe size={13} />
            Configurar Integração de Navegadores
          </button>
        </div>
      </div>
    </section>
  );
}
