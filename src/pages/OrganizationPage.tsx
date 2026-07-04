import { CheckCircle2, FolderOpen, RefreshCw } from "lucide-react";
import { useState } from "react";
import { downloadCategories } from "../domain/categories";
import type { AppSettings } from "../domain/settings";
import { createCategoryFolders } from "../services/folderService";

export function OrganizationPage({ settings }: { settings: AppSettings }) {
  const [state, setState] = useState<"idle"|"busy"|"done"|"error">("idle");
  const syncFolders = async () => { setState("busy"); try { await createCategoryFolders(settings.rootDownloadFolder); setState("done"); } catch { setState("error"); } };
  return <section className="page"><header className="content-header"><div><span className="eyebrow">Biblioteca</span><h1>Organização</h1><p>Visualize as categorias criadas dentro da pasta principal.</p></div><button className="secondary-button" disabled={state === "busy" || !settings.rootDownloadFolder} onClick={syncFolders}><RefreshCw size={17} className={state === "busy" ? "spin" : ""}/> Criar estrutura</button></header>
    {!settings.rootDownloadFolder && <div className="notice"><FolderOpen size={20}/><div><strong>Escolha uma pasta principal</strong><span>Configure o destino em Configurações antes de criar a estrutura.</span></div></div>}
    {state === "done" && <div className="success-banner"><CheckCircle2 size={18}/> Estrutura de pastas verificada com sucesso.</div>}{state === "error" && <div className="error-banner">Não foi possível criar as pastas. Verifique o caminho e as permissões.</div>}
    <div className="category-grid">{downloadCategories.map(({ name, extensions, icon: Icon, color }) => <article className="category-card" key={name}><div className="category-icon" style={{ color, backgroundColor: `${color}18` }}><Icon size={22}/></div><div><h2>{name}</h2><p>{extensions.length ? extensions.map((item) => `.${item}`).join(", ") : "Extensões não classificadas"}</p><span>{settings.rootDownloadFolder ? `${settings.rootDownloadFolder}\\${name}` : `Pasta raiz\\${name}`}</span></div></article>)}</div>
  </section>;
}
