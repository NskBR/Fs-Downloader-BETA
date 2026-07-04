import { Check, FolderOpen, Languages, Save } from "lucide-react";
import { useState } from "react";
import type { AppLanguage, AppSettings } from "../domain/settings";
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
    [error, setError] = useState<string | null>(null);
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
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!draft.rootDownloadFolder.trim())
        throw new Error("Escolha a pasta principal de downloads.");
      if (draft.autoOrganizeEnabled)
        await createCategoryFolders(draft.rootDownloadFolder);
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
          <span>PREFERÊNCIAS</span>
          <h1>Configurações</h1>
          <p>Somente o essencial para usar o SF Downloader.</p>
        </div>
        <button className="primary-button" disabled={busy} onClick={submit}>
          {saved ? <Check /> : <Save />}
          {busy ? "Salvando..." : saved ? "Salvo" : "Salvar"}
        </button>
      </header>
      {error && <div className="error-banner">{error}</div>}
      <div className="simple-settings-list">
        <article>
          <i>
            <Languages />
          </i>
          <div className="setting-copy">
            <strong>Idioma da interface</strong>
            <span>Define o idioma usado nos textos do aplicativo.</span>
          </div>
          <select
            value={draft.language}
            onChange={(event) =>
              update("language", event.target.value as AppLanguage)
            }
          >
            <option value="pt-BR">Português (Brasil)</option>
            <option value="en-US">English (em preparação)</option>
          </select>
        </article>
        <article>
          <i>
            <FolderOpen />
          </i>
          <div className="setting-copy">
            <strong>Local padrão dos arquivos</strong>
            <span>
              Downloads e categorias serão armazenados a partir desta pasta.
            </span>
          </div>
          <div className="compact-folder-picker">
            <span title={draft.rootDownloadFolder}>
              {draft.rootDownloadFolder || "Nenhuma pasta selecionada"}
            </span>
            <button onClick={selectFolder}>Escolher pasta</button>
          </div>
        </article>
      </div>
    </section>
  );
}
