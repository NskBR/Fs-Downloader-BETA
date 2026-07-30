import { Plus, Tags, Trash2, Globe } from "lucide-react";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppLanguage, AppSettings, AccentColor, AppColor, AppTheme } from "../domain/settings";
import { downloadCategories } from "../domain/categories";
import {
  chooseDownloadFolder,
  createCategoryFolders,
} from "../services/folderService";
import { isLaunchOnStartup, setLaunchOnStartup } from "../services/downloadService";
import { Toggle } from "../components/ui/Toggle";
import { DiscordThemeCustomizer } from "../components/ui/DiscordThemeCustomizer";
import type { GradientConfig } from "../domain/settings";

function hueSatOf(hex: string): [number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean.padEnd(6, "0").slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const light = (max + min) / 2;
  let hue = 0, sat = 0;
  if (delta !== 0) {
    sat = light > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    switch (max) {
      case r: hue = ((g - b) / delta) % 6; break;
      case g: hue = (b - r) / delta + 2; break;
      default: hue = (r - g) / delta + 4; break;
    }
    hue = (hue * 60 + 360) % 360;
  }
  return [hue, sat];
}

function pickAppColorFromGradient(config: GradientConfig): AppColor {
  // Usa o stop mais saturado como cor representativa do gradiente.
  let best = config.stops[0]?.color ?? "#16171a";
  let bestSat = -1;
  for (const stop of config.stops) {
    const [, sat] = hueSatOf(stop.color);
    if (sat > bestSat) { bestSat = sat; best = stop.color; }
  }
  const [hue, sat] = hueSatOf(best);
  if (sat < 0.15) return "slate";
  if (hue < 20 || hue >= 330) return "rose";
  if (hue < 70) return "rose";
  if (hue < 170) return "mint";
  if (hue < 260) return "ocean";
  return "rose";
}

const interfaceGradientPresets: GradientConfig[] = [
  { enabled: true, type: "linear", angle: 160, intensity: 40, stops: [{ color: "#16171a", position: 0 }, { color: "#1f2024", position: 100 }] },
  { enabled: true, type: "linear", angle: 160, intensity: 30, stops: [{ color: "#0c0d10", position: 0 }, { color: "#15171c", position: 100 }] },
  { enabled: true, type: "linear", angle: 200, intensity: 45, stops: [{ color: "#0f151b", position: 0 }, { color: "#16212b", position: 100 }] },
  { enabled: true, type: "linear", angle: 160, intensity: 40, stops: [{ color: "#1a1417", position: 0 }, { color: "#221a1e", position: 100 }] },
  { enabled: true, type: "radial", angle: 160, intensity: 45, stops: [{ color: "#15171c", position: 0 }, { color: "#0c0d10", position: 100 }] },
  { enabled: true, type: "linear", angle: 135, intensity: 35, stops: [{ color: "#121815", position: 0 }, { color: "#1a201d", position: 100 }] },
];

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
  useEffect(() => {
    void isLaunchOnStartup()
      .then((enabled) => setDraft((current) => ({ ...current, launchOnStartup: enabled })))
      .catch(() => {});
  }, []);
  const save = async (next: AppSettings) => {
    setError(null);
    try {
      if (next.autoOrganizeEnabled)
        await createCategoryFolders(
          next.rootDownloadFolder,
          next.customCategories.map((category) => category.name),
        );
      onSave(next);
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
            Define a cor do acento usada em botões, progresso e destaques do aplicativo. Suporta cores sólidas e gradientes.
          </span>
          <div className="accent-swatches">
            {[
              { id: "cyan", name: "Ciano Elétrico", bg: "#06b6d4" },
              { id: "emerald", name: "Verde Esmeralda", bg: "#10b981" },
              { id: "amber", name: "Âmbar Dourado", bg: "#f59e0b" },
              { id: "red", name: "Carmim Obscuro", bg: "#ef4444" },
              { id: "blue", name: "Azul Cobalto", bg: "#3b82f6" },
              { id: "violet", name: "Violeta Ametista", bg: "#8b5cf6" },
              { id: "pink", name: "Pink Neon", bg: "#ec4899" },
              { id: "coral", name: "Coral Laranja", bg: "#f97316" },
              { id: "gradient_sunset", name: "Gradiente Fogo Sunset", bg: "linear-gradient(135deg, #ff4500, #ff8c00)" },
              { id: "gradient_cyberpunk", name: "Gradiente Cyberpunk Pink/Roxo", bg: "linear-gradient(135deg, #ec4899, #8b5cf6)" },
              { id: "gradient_ocean", name: "Gradiente Oceano Ciano/Azul", bg: "linear-gradient(135deg, #06b6d4, #3b82f6)" },
              { id: "gradient_aurora", name: "Gradiente Aurora Esmeralda/Ciano", bg: "linear-gradient(135deg, #10b981, #06b6d4)" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                className={`accent-swatch ${draft.accentColor === item.id ? "active" : ""}`}
                style={{ background: item.bg }}
                onClick={() => update("accentColor", item.id as AccentColor)}
                aria-label={item.name}
                title={item.name}
              />
            ))}
          </div>
        </div>

        <div className="setting-item setting-item--full">
          <DiscordThemeCustomizer
            config={draft.interfaceGradient}
            appColor={draft.appColor}
            onChangeGradient={(value) => {
              const next = { ...draft, interfaceGradient: value };
              setDraft(next);
              if (next.rootDownloadFolder.trim()) void save(next);
              else setError("Escolha a pasta principal de downloads.");
            }}
            onSelectAppColor={(color) => {
              const next = {
                ...draft,
                appColor: color,
                interfaceGradient: { ...draft.interfaceGradient, enabled: false },
              };
              setDraft(next);
              if (next.rootDownloadFolder.trim()) void save(next);
              else setError("Escolha a pasta principal de downloads.");
            }}
          />
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

        <div className="setting-item setting-item--toggle">
           <div>
             <label>Iniciar com o Windows</label>
             <span className="description">
               Abre o SF Downloader automaticamente quando o Windows ligar.
             </span>
           </div>
           <Toggle
             checked={draft.launchOnStartup}
             onChange={(value) => {
               update("launchOnStartup", value);
               void setLaunchOnStartup(value).catch(console.error);
             }}
             label="Iniciar com o Windows"
           />
         </div>

         <div className="setting-item setting-item--toggle">
           <div>
             <label>Animar seletor do sidebar</label>
             <span className="description">
               Ativa a animação suave do indicador ao navegar entre páginas.
             </span>
           </div>
           <Toggle
             checked={draft.sidebarAnimation}
             onChange={(value) => update("sidebarAnimation", value)}
             label="Animar seletor do sidebar"
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
          <h2>Extração</h2>
        </div>

        <div className="setting-item setting-item--toggle">
          <div>
            <label>Apagar arquivo após extração</label>
            <span className="description">
              Quando a extração automática conclui com sucesso, o arquivo
              compactado original é removido. Em caso de falha, o arquivo é
              mantido e a pasta extraída parcialmente é apagada.
            </span>
            <span className="beta-tag">BETA — pode cometer erro</span>
          </div>
          <Toggle
            checked={draft.deleteArchiveAfterExtract}
            onChange={(value) => update("deleteArchiveAfterExtract", value)}
            label="Apagar arquivo após extração"
          />
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
