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
  const [folder, setFolder] = useState("");
  const [copied, setCopied] = useState(false);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    const target = tab === "chromium" ? "chromium" : "firefox";
    invoke<string>("get_extension_dir", { browser: target })
      .then(setFolder)
      .catch(console.error);
  }, [tab]);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };
  const openXpi = () =>
    folder && void service.openFile(`${folder}/integration.xpi`).catch(console.error);
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
            <div className="integr-drop" onMouseDown={(e) => { e.preventDefault(); folder && void invoke("start_drag_folder", { path: folder }).catch(console.error); }} title="Arraste para a página de extensões do navegador">
              <div className="integr-drop-icon">
                <Package size={34} />
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
            <div className="integr-xpi" onClick={openXpi} title="Clique para abrir o arquivo .xpi no Firefox">
              <div className="integr-drop-icon">
                <Package size={34} />
              </div>
              <strong>integration.xpi</strong>
              <span>
                Arquivo de instalação do Firefox. Clique para abrir no navegador
                ou use “Abrir pasta” e instale manualmente.
              </span>
            </div>

            <ol className="integr-steps">
              <li>
                Clique na peça acima para abrir o <code>integration.xpi</code> no
                Firefox e confirme a instalação.
              </li>
              <li>
                Ou abra <code>about:addons</code> → engrenagem → “Instalar
                complemento a partir de arquivo…” e selecione o .xpi.
              </li>
              <li>
                Para testes, carregue temporariamente em{" "}
                <code>about:debugging#/runtime/this-firefox</code>.
              </li>
            </ol>
          </div>
        )}
      </main>
    </div>
  );
}
