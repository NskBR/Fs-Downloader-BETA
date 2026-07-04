import { Check, Plus, Save, Tags, Trash2 } from "lucide-react";
import { useState } from "react";
import type { AppLanguage, AppSettings } from "../domain/settings";
import { downloadCategories } from "../domain/categories";
import {
  chooseDownloadFolder,
  createCategoryFolders,
} from "../services/folderService";

interface Props {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  saved: boolean;
  onBack: () => void;
}

export function SettingsPage({ settings, onSave, saved }: Props) {
  const [draft, setDraft] = useState(settings),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [categoryName, setCategoryName] = useState(""),
    [categoryExtensions, setCategoryExtensions] = useState("");
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
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
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!draft.rootDownloadFolder.trim())
        throw new Error("Escolha a pasta principal de downloads.");
      if (draft.autoOrganizeEnabled)
        await createCategoryFolders(
          draft.rootDownloadFolder,
          draft.customCategories.map((category) => category.name),
        );
      onSave({ ...draft, theme: settings.theme });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar as configurações.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="simple-settings">
      <header>
        <div>
          <h1>Configurações</h1>
          <p>Somente o essencial para usar o SF Downloader.</p>
        </div>
        <button className="settings-save-btn" disabled={busy} onClick={submit}>
          {saved ? <Check size={13} /> : <Save size={13} />}
          {busy ? "Salvando..." : saved ? "Salvo" : "Salvar"}
        </button>
      </header>
      {error && <div className="error-banner">{error}</div>}

      <div className="simple-settings-list">
        <div className="setting-section">
          <h2>Geral</h2>
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
      </div>
    </section>
  );
}
