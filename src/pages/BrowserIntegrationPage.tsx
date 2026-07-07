import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { 
  Chrome, 
  FolderOpen, 
  Copy, 
  Check, 
  X, 
  HelpCircle,
  ExternalLink,
  Download
} from "lucide-react";

interface BrowserOption {
  id: string;
  name: string;
  type: "chromium" | "firefox";
  iconName: string;
  extensionUrl: string;
}

const BROWSERS: BrowserOption[] = [
  { id: "chrome", name: "Google Chrome", type: "chromium", iconName: "chrome", extensionUrl: "chrome://extensions" },
  { id: "firefox", name: "Mozilla Firefox", type: "firefox", iconName: "firefox", extensionUrl: "about:addons" },
  { id: "edge", name: "Microsoft Edge", type: "chromium", iconName: "edge", extensionUrl: "edge://extensions" },
  { id: "opera", name: "Opera Browser", type: "chromium", iconName: "opera", extensionUrl: "opera://extensions" },
  { id: "brave", name: "Brave Browser", type: "chromium", iconName: "brave", extensionUrl: "brave://extensions" },
  { id: "vivaldi", name: "Vivaldi Browser", type: "chromium", iconName: "vivaldi", extensionUrl: "vivaldi://extensions" }
];

export function BrowserIntegrationPage() {
  const [selectedBrowser, setSelectedBrowser] = useState<BrowserOption>(BROWSERS[0]);
  const [folderPath, setFolderPath] = useState<string>("");
  const [copiedPath, setCopiedPath] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    // Busca o caminho físico da extensão para o navegador selecionado
    const targetBrowser = selectedBrowser.type === "chromium" ? "chromium" : "firefox";
    invoke<string>("get_extension_dir", { browser: targetBrowser })
      .then(setFolderPath)
      .catch(console.error);
  }, [selectedBrowser]);

  const handleCopyPath = () => {
    navigator.clipboard.writeText(folderPath);
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 2000);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText("http://127.0.0.1:17831/extension.xpi");
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleOpenFolder = () => {
    if (folderPath) {
      void invoke("open_folder", { path: folderPath }).catch(console.error);
    }
  };

  const handleClose = () => {
    void getCurrentWindow().close();
  };

  return (
    <div className="download-window complete-compact xdm-window">
      {/* Titlebar Arrastável */}
      <header className="window-titlebar" data-tauri-drag-region>
        <div className="window-title" data-tauri-drag-region>
          Integração de Navegadores
        </div>
        <button className="window-close-btn" onClick={handleClose} title="Fechar">
          <X size={14} />
        </button>
      </header>

      {/* Conteúdo Principal */}
      <main className="download-window-content browser-integration-layout">
        
        {/* Menu Lateral de Navegadores */}
        <aside className="browser-sidebar">
          {BROWSERS.map((browser) => {
            const isSelected = selectedBrowser.id === browser.id;
            return (
              <button 
                key={browser.id}
                className={`browser-menu-item ${isSelected ? "active" : ""}`}
                onClick={() => {
                  setSelectedBrowser(browser);
                  setCopiedPath(false);
                  setCopiedLink(false);
                }}
              >
                <Chrome size={16} className={`browser-icon-clr ${browser.id}`} />
                <span>{browser.name}</span>
              </button>
            );
          })}
        </aside>

        {/* Painel de Instruções */}
        <section className="browser-instructions">
          <h2>Monitoramento de Navegador</h2>
          <p className="subtitle">
            Siga as instruções abaixo para instalar a extensão no <strong>{selectedBrowser.name}</strong>.
          </p>

          <hr className="divider" />

          {selectedBrowser.type === "chromium" ? (
            <div className="steps-container">
              <ol className="steps-list">
                <li>
                  Abra a página de extensões copiando e acessando o link abaixo:
                  <div className="link-box">
                    <code>{selectedBrowser.extensionUrl}</code>
                  </div>
                </li>
                <li>
                  No topo direito, ative a opção <strong>"Modo do desenvolvedor"</strong> (Developer Mode).
                </li>
                <li>
                  Clique em <strong>"Carregar descompactada"</strong> (Load unpacked) e selecione a pasta da extensão, ou simplesmente abra o Windows Explorer e arraste a pasta para dentro do navegador.
                </li>
              </ol>

              <div className="action-row">
                <div className="path-info">
                  <span>Pasta da Extensão:</span>
                  <code title={folderPath}>{folderPath || "Carregando..."}</code>
                </div>
                
                <div className="btn-group-row">
                  <button className="action-btn" onClick={handleCopyPath} disabled={!folderPath}>
                    {copiedPath ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copiedPath ? "Copiado!" : "Copiar Caminho"}</span>
                  </button>
                  
                  <button className="action-btn" onClick={handleOpenFolder} disabled={!folderPath}>
                    <FolderOpen size={14} />
                    <span>Abrir Pasta</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="steps-container">
              <ol className="steps-list">
                <li>
                  Se o Firefox for seu navegador padrão, clique no botão <strong>Instalar Diretamente</strong> abaixo.
                </li>
                <li>
                  Caso contrário, abra o Firefox, acesse a página de Extensões (<code>about:addons</code>), clique na engrenagem e selecione <strong>"Instalar complemento a partir de arquivo..."</strong>.
                </li>
                <li>
                  Selecione o arquivo <code>integration.xpi</code> localizado na pasta da extensão.
                </li>
              </ol>

              <div className="action-row">
                <div className="path-info">
                  <span>Link de Instalação:</span>
                  <code>http://127.0.0.1:17831/extension.xpi</code>
                </div>

                <div className="btn-group-row">
                  <a 
                    className="action-btn link-btn" 
                    href="http://127.0.0.1:17831/extension.xpi" 
                    target="_blank" 
                    rel="noreferrer"
                  >
                    <Download size={14} />
                    <span>Instalar Diretamente</span>
                  </a>

                  <button className="action-btn" onClick={handleCopyLink}>
                    {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copiedLink ? "Copiado!" : "Copiar Link"}</span>
                  </button>

                  <button className="action-btn" onClick={handleOpenFolder} disabled={!folderPath}>
                    <FolderOpen size={14} />
                    <span>Abrir Pasta</span>
                  </button>
                </div>
              </div>

              <div className="help-box">
                <HelpCircle size={14} />
                <span>
                  <strong>Nota para testes:</strong> Se a extensão ainda não estiver assinada permanentemente, você pode carregá-la temporariamente no Firefox acessando <code>about:debugging#/runtime/this-firefox</code> e selecionando o arquivo <code>manifest.json</code> na pasta da extensão.
                </span>
              </div>
            </div>
          )}

          <footer className="footer-actions">
            <button className="close-action-btn" onClick={handleClose}>
              Concluído
            </button>
          </footer>
        </section>

      </main>
    </div>
  );
}
