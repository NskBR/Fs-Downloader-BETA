import {
  Plus,
  Tags,
  Trash2,
  Globe,
  Palette,
  Download,
  Folder,
  Settings2,
  Gauge,
  Sliders,
  Play,
  Package,
  FileText,
  ChevronsUp,
  Info,
  CheckCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppLanguage, AppSettings, AccentColor, AppColor } from "../domain/settings";
import { downloadCategories } from "../domain/categories";
import {
  chooseDownloadFolder,
  createCategoryFolders,
} from "../services/folderService";
import { isLaunchOnStartup, setLaunchOnStartup } from "../services/downloadService";
import { Toggle } from "../components/ui/Toggle";
import { CustomSelect } from "../components/ui/CustomSelect";
import { DiscordThemeCustomizer } from "../components/ui/DiscordThemeCustomizer";

type SettingsTab = "personalizacao" | "downloads" | "arquivos" | "idioma" | "avancado";

interface Props {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  saved: boolean;
  onBack: () => void;
}

export function SettingsPage({ settings, onSave, saved }: Props) {
  const [draft, setDraft] = useState(settings);
  const [activeTab, setActiveTab] = useState<SettingsTab>("downloads");
  const [error, setError] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryExtensions, setCategoryExtensions] = useState("");

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    if (next.rootDownloadFolder.trim()) void save(next);
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
      setError("Informe um nome de categoria válido, sem caracteres de caminho.");
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

  const tabs = [
    { id: "personalizacao", label: "Personalização", icon: <Palette size={16} /> },
    { id: "downloads", label: "Downloads", icon: <Download size={16} /> },
    { id: "arquivos", label: "Arquivos", icon: <Folder size={16} /> },
    { id: "idioma", label: "Idioma", icon: <Globe size={16} /> },
    { id: "avancado", label: "Avançado", icon: <Settings2 size={16} /> },
  ];

  return (
    <section className="cfg-container">
      {/* Cabeçalho da Página */}
      <header className="cfg-header">
        <div>
          <h1 className="cfg-title">Configurações</h1>
          <p className="cfg-subtitle">Organize as preferências do aplicativo por categoria.</p>
        </div>
        {saved && <span className="cfg-autosave">Salvo automaticamente</span>}
      </header>

      {error && <div className="error-banner">{error}</div>}

      {/* Navegação por Abas Horizontais */}
      <nav className="cfg-nav-tabs">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={`cfg-tab-btn ${isActive ? "is-active" : ""}`}
              onClick={() => setActiveTab(tab.id as SettingsTab)}
            >
              <span className="cfg-tab-icon">{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Conteúdo da Aba Ativa */}
      <div className="cfg-tab-content">
        {/* ABA: DOWNLOADS (EXATAMENTE COMO NA FOTO DE REFERÊNCIA) */}
        {activeTab === "downloads" && (
          <div className="cfg-tab-view">
            <div className="cfg-grid-2col">
              {/* Coluna da Esquerda */}
              <div className="cfg-col">
                {/* 1. Local de download */}
                <div className="cfg-card">
                  <div className="cfg-card-header">
                    <div className="cfg-card-icon-box">
                      <Folder className="cfg-card-icon" size={20} />
                    </div>
                    <div>
                      <h3 className="cfg-card-title">1. Local de download</h3>
                      <p className="cfg-card-subtitle">Escolha onde os arquivos serão salvos por padrão.</p>
                    </div>
                  </div>

                  <div className="cfg-card-content">
                    <div className="cfg-path-input-row">
                      <div className="cfg-path-display" title={draft.rootDownloadFolder}>
                        {draft.rootDownloadFolder || "Selecione uma pasta..."}
                      </div>
                      <button type="button" className="cfg-btn-alterar" onClick={selectFolder}>
                        <Folder size={15} />
                        <span>Alterar</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* 3. Desempenho */}
                <div className="cfg-card">
                  <div className="cfg-card-header">
                    <div className="cfg-card-icon-box">
                      <Gauge className="cfg-card-icon" size={20} />
                    </div>
                    <div>
                      <h3 className="cfg-card-title">3. Desempenho</h3>
                      <p className="cfg-card-subtitle">Ajuste o desempenho e a prioridade dos downloads.</p>
                    </div>
                  </div>

                  <div className="cfg-card-content cfg-list-items">
                    <div className="cfg-item-row">
                      <div className="cfg-item-left">
                        <Sliders size={18} className="cfg-item-icon" />
                        <div>
                          <strong className="cfg-item-label">Downloads simultâneos</strong>
                          <span className="cfg-item-desc">Quantos downloads podem ocorrer ao mesmo tempo.</span>
                        </div>
                      </div>
                      <div className="cfg-item-right">
                        <CustomSelect
                          value={String(draft.maxParallelDownloads ?? 3)}
                          options={[
                            { value: "1", label: "1" },
                            { value: "2", label: "2" },
                            { value: "3", label: "3" },
                            { value: "4", label: "4" },
                            { value: "5", label: "5" },
                            { value: "6", label: "6" },
                            { value: "8", label: "8" },
                            { value: "10", label: "10" },
                            { value: "16", label: "16" },
                          ]}
                          onChange={(val) => update("maxParallelDownloads", Number(val))}
                        />
                      </div>
                    </div>

                    <div className="cfg-item-row">
                      <div className="cfg-item-left">
                        <Gauge size={18} className="cfg-item-icon" />
                        <div>
                          <strong className="cfg-item-label">Limite de velocidade</strong>
                          <span className="cfg-item-desc">Defina o limite máximo de download.</span>
                        </div>
                      </div>
                      <div className="cfg-item-right">
                        <CustomSelect
                          value={draft.speedLimitText || "Sem limite"}
                          options={[
                            { value: "Sem limite", label: "Sem limite" },
                            { value: "1 MB/s", label: "1 MB/s" },
                            { value: "5 MB/s", label: "5 MB/s" },
                            { value: "10 MB/s", label: "10 MB/s" },
                            { value: "25 MB/s", label: "25 MB/s" },
                            { value: "50 MB/s", label: "50 MB/s" },
                          ]}
                          onChange={(val) => update("speedLimitText", val)}
                        />
                      </div>
                    </div>

                    <div className="cfg-item-row">
                      <div className="cfg-item-left">
                        <ChevronsUp size={18} className="cfg-item-icon" />
                        <div>
                          <strong className="cfg-item-label">Prioridade</strong>
                          <span className="cfg-item-desc">Define a prioridade dos downloads na rede.</span>
                        </div>
                      </div>
                      <div className="cfg-item-right">
                        <CustomSelect
                          value={draft.downloadPriority || "Alta"}
                          options={[
                            { value: "Alta", label: "Alta" },
                            { value: "Normal", label: "Normal" },
                            { value: "Baixa", label: "Baixa" },
                          ]}
                          onChange={(val) => update("downloadPriority", val)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Coluna da Direita */}
              <div className="cfg-col">
                {/* 2. Comportamento do download */}
                <div className="cfg-card">
                  <div className="cfg-card-header">
                    <div className="cfg-card-icon-box">
                      <Sliders className="cfg-card-icon" size={20} />
                    </div>
                    <div>
                      <h3 className="cfg-card-title">2. Comportamento do download</h3>
                      <p className="cfg-card-subtitle">Defina como os downloads devem se comportar.</p>
                    </div>
                  </div>

                  <div className="cfg-card-content cfg-list-items">
                    <div className="cfg-item-row">
                      <div className="cfg-item-left">
                        <Play size={18} className="cfg-item-icon" />
                        <div>
                          <strong className="cfg-item-label">Iniciar automaticamente</strong>
                          <span className="cfg-item-desc">Inicia os downloads automaticamente ao adicioná-los.</span>
                        </div>
                      </div>
                      <div className="cfg-item-right">
                        <Toggle
                          checked={draft.autoStartDownloads ?? true}
                          onChange={(val) => update("autoStartDownloads", val)}
                        />
                      </div>
                    </div>

                    <div className="cfg-item-row">
                      <div className="cfg-item-left">
                        <Package size={18} className="cfg-item-icon" />
                        <div>
                          <strong className="cfg-item-label">Extrair após concluir</strong>
                          <span className="cfg-item-desc">Extrai arquivos compactados automaticamente.</span>
                        </div>
                      </div>
                      <div className="cfg-item-right">
                        <Toggle
                          checked={draft.deleteArchiveAfterExtract}
                          onChange={(val) => update("deleteArchiveAfterExtract", val)}
                        />
                      </div>
                    </div>

                    <div className="cfg-item-row">
                      <div className="cfg-item-left">
                        <Folder size={18} className="cfg-item-icon" />
                        <div>
                          <strong className="cfg-item-label">Abrir pasta ao finalizar</strong>
                          <span className="cfg-item-desc">Abre a pasta de destino quando o download terminar.</span>
                        </div>
                      </div>
                      <div className="cfg-item-right">
                        <Toggle
                          checked={draft.openFolderOnComplete ?? false}
                          onChange={(val) => update("openFolderOnComplete", val)}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4. Organização */}
                <div className="cfg-card">
                  <div className="cfg-card-header">
                    <div className="cfg-card-icon-box">
                      <Folder className="cfg-card-icon" size={20} />
                    </div>
                    <div>
                      <h3 className="cfg-card-title">4. Organização</h3>
                      <p className="cfg-card-subtitle">Mantenha seus downloads organizados automaticamente.</p>
                    </div>
                  </div>

                  <div className="cfg-card-content cfg-list-items">
                    <div className="cfg-item-row">
                      <div className="cfg-item-left">
                        <FileText size={18} className="cfg-item-icon" />
                        <div>
                          <strong className="cfg-item-label">Criar subpastas por categoria</strong>
                          <span className="cfg-item-desc">Organiza os downloads em pastas por tipo de arquivo.</span>
                        </div>
                      </div>
                      <div className="cfg-item-right">
                        <Toggle
                          checked={draft.autoOrganizeEnabled}
                          onChange={(val) => update("autoOrganizeEnabled", val)}
                        />
                      </div>
                    </div>

                    <div className="cfg-item-row">
                      <div className="cfg-item-left">
                        <FileText size={18} className="cfg-item-icon" />
                        <div>
                          <strong className="cfg-item-label">Renomear arquivos automaticamente</strong>
                          <span className="cfg-item-desc">Usa o nome original do conteúdo quando disponível.</span>
                        </div>
                      </div>
                      <div className="cfg-item-right">
                        <Toggle
                          checked={draft.autoRenameDuplicates ?? false}
                          onChange={(val) => update("autoRenameDuplicates", val)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Banner Dica */}
            <div className="cfg-tip-banner">
              <div className="cfg-tip-left">
                <div className="cfg-tip-info-icon">
                  <Info size={24} />
                </div>
                <div>
                  <strong className="cfg-tip-title">Dica</strong>
                  <p className="cfg-tip-desc">
                    As configurações estão organizadas por abas para facilitar a navegação. Ajuste apenas o que faz sentido para o seu fluxo e aproveite o SF Downloader!
                  </p>
                </div>
              </div>
              <div className="cfg-tip-badge">
                <div className="cfg-tip-graphic">
                  <CheckCircle size={28} className="cfg-tip-check" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ABA: PERSONALIZAÇÃO */}
        {activeTab === "personalizacao" && (
          <div className="cfg-tab-view">
            <div className="cfg-card">
              <div className="cfg-card-header">
                <div className="cfg-card-icon-box">
                  <Palette className="cfg-card-icon" size={20} />
                </div>
                <div>
                  <h3 className="cfg-card-title">Cor de Destaque do Aplicativo</h3>
                  <p className="cfg-card-subtitle">Define a cor principal usada em botões, progresso e seletores.</p>
                </div>
              </div>
              <div className="cfg-card-content">
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
            </div>

            <div className="cfg-card">
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

            <div className="cfg-card">
              <div className="cfg-card-header">
                <div className="cfg-card-icon-box">
                  <Sliders className="cfg-card-icon" size={20} />
                </div>
                <div>
                  <h3 className="cfg-card-title">Animações da Interface</h3>
                  <p className="cfg-card-subtitle">Personalize a movimentação de elementos da barra lateral.</p>
                </div>
              </div>
              <div className="cfg-card-content cfg-list-items">
                <div className="cfg-item-row">
                  <div className="cfg-item-left">
                    <Sliders size={18} className="cfg-item-icon" />
                    <div>
                      <strong className="cfg-item-label">Animar seletor do sidebar</strong>
                      <span className="cfg-item-desc">Ativa a animação suave do indicador ao navegar entre páginas.</span>
                    </div>
                  </div>
                  <div className="cfg-item-right">
                    <Toggle
                      checked={draft.sidebarAnimation}
                      onChange={(value) => update("sidebarAnimation", value)}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ABA: ARQUIVOS */}
        {activeTab === "arquivos" && (
          <div className="cfg-tab-view">
            <div className="cfg-card">
              <div className="cfg-card-header">
                <div className="cfg-card-icon-box">
                  <Folder className="cfg-card-icon" size={20} />
                </div>
                <div>
                  <h3 className="cfg-card-title">Categorias Personalizadas</h3>
                  <p className="cfg-card-subtitle">Crie pastas para organizar automaticamente os arquivos baixados.</p>
                </div>
              </div>
              <div className="cfg-card-content">
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
                  <button type="button" onClick={addCategory} disabled={!categoryName.trim()}>
                    <Plus size={16} />
                    <span>Adicionar</span>
                  </button>
                </div>

                <div className="custom-category-list">
                  {draft.customCategories.length === 0 ? (
                    <p>Nenhuma categoria personalizada.</p>
                  ) : (
                    draft.customCategories.map((category) => (
                      <article key={category.id}>
                        <Tags size={16} />
                        <div>
                          <strong>{category.name}</strong>
                          <span>
                            {category.extensions.length
                              ? category.extensions.map((ext) => `.${ext}`).join(", ")
                              : "Sem extensões automáticas"}
                          </span>
                        </div>
                        <button
                          type="button"
                          title="Remover categoria"
                          onClick={() => removeCategory(category.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </article>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ABA: IDIOMA */}
        {activeTab === "idioma" && (
          <div className="cfg-tab-view">
            <div className="cfg-card">
              <div className="cfg-card-header">
                <div className="cfg-card-icon-box">
                  <Globe className="cfg-card-icon" size={20} />
                </div>
                <div>
                  <h3 className="cfg-card-title">Idioma da Interface</h3>
                  <p className="cfg-card-subtitle">Selecione o idioma utilizado nos textos do aplicativo.</p>
                </div>
              </div>
              <div className="cfg-card-content cfg-list-items">
                <div className="cfg-item-row">
                  <div className="cfg-item-left">
                    <Globe size={18} className="cfg-item-icon" />
                    <div>
                      <strong className="cfg-item-label">Idioma do aplicativo</strong>
                      <span className="cfg-item-desc">Define a linguagem de menus e notificações.</span>
                    </div>
                  </div>
                  <div className="cfg-item-right">
                    <CustomSelect
                      value={draft.language}
                      options={[
                        { value: "pt-BR", label: "Português (Brasil)" },
                        { value: "en-US", label: "English (US)" },
                      ]}
                      onChange={(val) => update("language", val as AppLanguage)}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ABA: AVANÇADO */}
        {activeTab === "avancado" && (
          <div className="cfg-tab-view">
            <div className="cfg-card">
              <div className="cfg-card-header">
                <div className="cfg-card-icon-box">
                  <Settings2 className="cfg-card-icon" size={20} />
                </div>
                <div>
                  <h3 className="cfg-card-title">Inicialização e Tray Mode</h3>
                  <p className="cfg-card-subtitle">Defina a integração do aplicativo com o sistema operacional.</p>
                </div>
              </div>
              <div className="cfg-card-content cfg-list-items">
                <div className="cfg-item-row">
                  <div className="cfg-item-left">
                    <Settings2 size={18} className="cfg-item-icon" />
                    <div>
                      <strong className="cfg-item-label">Inicializar em tray mode</strong>
                      <span className="cfg-item-desc">Inicia o SF Downloader oculto na bandeja do sistema.</span>
                    </div>
                  </div>
                  <div className="cfg-item-right">
                    <Toggle
                      checked={draft.startInTrayMode}
                      onChange={(value) => update("startInTrayMode", value)}
                    />
                  </div>
                </div>

                <div className="cfg-item-row">
                  <div className="cfg-item-left">
                    <Settings2 size={18} className="cfg-item-icon" />
                    <div>
                      <strong className="cfg-item-label">Iniciar com o Windows</strong>
                      <span className="cfg-item-desc">Abre o aplicativo automaticamente ao ligar o computador.</span>
                    </div>
                  </div>
                  <div className="cfg-item-right">
                    <Toggle
                      checked={draft.launchOnStartup}
                      onChange={(value) => {
                        update("launchOnStartup", value);
                        void setLaunchOnStartup(value).catch(console.error);
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="cfg-card">
              <div className="cfg-card-header">
                <div className="cfg-card-icon-box">
                  <Globe className="cfg-card-icon" size={20} />
                </div>
                <div>
                  <h3 className="cfg-card-title">Integração de Navegadores</h3>
                  <p className="cfg-card-subtitle">Captação automática de links nos navegadores web.</p>
                </div>
              </div>
              <div className="cfg-card-content">
                <p style={{ fontSize: "12.5px", color: "var(--text-2)", marginBottom: "12px" }}>
                  Instale a extensão do SF Downloader para capturar downloads nos navegadores Chromium (Chrome, Edge, Opera, Brave, Vivaldi) e Firefox.
                </p>
                <button
                  type="button"
                  className="cfg-btn-alterar"
                  onClick={openBrowserIntegration}
                >
                  <Globe size={15} />
                  <span>Configurar Integração</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
