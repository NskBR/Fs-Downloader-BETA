import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import {
  Chrome,
  Copy,
  Check,
  X,
  Puzzle,
  Flame,
  Package,
} from "lucide-react";
import * as service from "../services/downloadService";

type Tab = "chromium" | "firefox";

export function BrowserIntegrationPage() {
  const [tab, setTab] = useState<Tab>("chromium");
  const [chromiumFolder, setChromiumFolder] = useState("");
  const [firefoxFolder, setFirefoxFolder] = useState("");
  const [copied, setCopied] = useState(false);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    invoke<string>("get_extension_dir", { browser: "chromium" })
      .then(setChromiumFolder)
      .catch(console.error);
    invoke<string>("get_extension_dir", { browser: "firefox" })
      .then(setFirefoxFolder)
      .catch(console.error);
  }, []);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };
  const openXpi = () =>
    firefoxFolder && void service.openFile(`${firefoxFolder}/integration.xpi`).catch(console.error);
  const close = () => void appWindow.close();

  return (
    <div className="integr-layout">
      <header className="integr-header" data-tauri-drag-region>
        <div className="integr-title">
          <Puzzle size={18} />
          <div>
            <strong>Integração de Navegadores</strong>
            <span>Conecte o navegador para capturar downloads no SF Downloader.</span>
          </div>
        </div>
        <button className="integr-close nodrag" onClick={close} title="Fechar">
          <X size={16} />
        </button>
      </header>

      <div className="integr-tabs">
        <button
          className={`integr-tab ${tab === "chromium" ? "active" : ""}`}
          onClick={() => setTab("chromium")}
        >
          <Chrome size={15} />
          Chromium
          <span className="integr-tab-sub">Chrome, Edge, Opera, Brave, Vivaldi</span>
        </button>
        <button
          className={`integr-tab ${tab === "firefox" ? "active" : ""}`}
          onClick={() => setTab("firefox")}
        >
          <Flame size={15} />
          Firefox
          <span className="integr-tab-sub">Instalar arquivo .xpi</span>
        </button>
      </div>

      <main className="integr-body">
        {tab === "chromium" ? (
          <div className="integr-install">
            <div className="integr-drop" onMouseDown={(e) => { e.preventDefault(); chromiumFolder && void invoke("start_drag_folder", { path: chromiumFolder }).catch(console.error); }} title="Arraste para a página de extensões do navegador">
              <div className="integr-drop-icon">
                <Package size={26} />
              </div>
              <strong>Arraste para o navegador</strong>
              <span>
                Segure e solte esta peça na página de extensões do seu navegador
                Chromium, como no Xtreme Downloader.
              </span>
            </div>

            <ol className="integr-steps">
              <li>
                Abra a página de extensões do navegador:
                <div className="integr-code">
                  <code>chrome://extensions</code>
                  <button className="integr-copy" onClick={() => copy("chrome://extensions")} title="Copiar">
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
              </li>
              <li>
                Ative o <strong>“Modo do desenvolvedor”</strong> no canto superior
                direito da página.
              </li>
              <li>
                Arraste a peça acima para a página de extensões do navegador.
              </li>
            </ol>
          </div>
        ) : (
          <div className="integr-install">
            <div
              className="integr-xpi"
              onClick={openXpi}
              onMouseDown={(e) => {
                e.preventDefault();
                firefoxFolder && void invoke("start_drag_folder", { path: `${firefoxFolder}/integration.xpi` }).catch(console.error);
              }}
              title="Clique para abrir/instalar no Firefox ou arraste para a aba do navegador"
            >
              <div className="integr-drop-icon">
                <Package size={26} />
              </div>
              <strong>integration.xpi (Clique ou Arraste)</strong>
              <span>
                Clique para instalar diretamente no Firefox ou segure e arraste esta peça para o seu navegador.
              </span>
            </div>

            <ol className="integr-steps">
              <li>
                Clique no card acima para abrir o instalador no Firefox, ou arraste-o direto para o navegador.
              </li>
              <li>
                Ou <button className="integr-link-btn" onClick={() => firefoxFolder && void service.revealInFolder(`${firefoxFolder}/integration.xpi`)}>abrir pasta no Explorer</button> para selecionar em <code>about:addons</code>.
              </li>
              <li>
                Para testes em desenvolvimento: <code>about:debugging#/runtime/this-firefox</code>.
              </li>
            </ol>
          </div>
        )}
      </main>
    </div>
  );
}
