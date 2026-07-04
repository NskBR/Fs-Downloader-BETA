import { X, FolderOpen, Download, Clock3 } from "lucide-react";
import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FileIcon } from "../components/downloads/FileIcon";
import { loadSettings } from "../services/settingsStorage";
import * as service from "../services/downloadService";

interface Payload { url:string; destination:string; requestId?:string; preview?:service.DownloadPreview }
const bytes=(value:number|null)=>{if(value===null)return"Tamanho desconhecido";const units=["B","KB","MB","GB","TB"];let size=value,index=0;while(size>=1024&&index<4){size/=1024;index++}return`${size.toFixed(index?1:0)} ${units[index]}`};

export function ConfirmationPage(){
  const payload=(()=>{try{return JSON.parse(localStorage.getItem("sf-downloader.confirmation")||"") as Payload}catch{return null}})();
  const [destination,setDestination]=useState(payload?.destination||"");
  const [preview,setPreview]=useState<service.DownloadPreview|null>(payload?.preview||null);
  const [loading,setLoading]=useState(Boolean(payload&&!payload.preview));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [resumeSupport, setResumeSupport] = useState(true);
  const appWindow=getCurrentWindow();

  useEffect(()=>{if(!payload||payload.preview)return;let active=true;void service.inspectDownload(payload.url).then(result=>{if(active)setPreview(result)}).catch(cause=>{if(active)setError(String(cause))}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[payload?.url]);
  const close=()=>void appWindow.close();
  
  const finish=async(mode:"now"|"later")=>{
    if(!preview)return;
    setBusy(true);
    setError(null);
    try{
      const settings=loadSettings();
      const task=mode==="now"
        ? await service.startDownload(preview.url,settings,destination,payload?.requestId,resumeSupport)
        : await service.queueDownload(preview.url,settings,destination,payload?.requestId,resumeSupport);
      await emit("download-created",task);
      localStorage.removeItem("sf-downloader.confirmation");
      close();
    }catch(cause){
      setError(String(cause));
    }finally{
      setBusy(false);
    }
  };

  if(!payload)return <main className="confirm-window"><div className="confirm-titlebar" data-tauri-drag-region><span>SF Downloader</span><button onClick={close}><X/></button></div><div className="confirm-empty">Solicitação de download não encontrada.</div></main>;
  
  return (
    <main className="confirm-window">
      <div className="confirm-titlebar" data-tauri-drag-region>
        <span>Novo download</span>
        <button onClick={close}><X/></button>
      </div>
      
      <section className="confirm-body xdm-confirm">
        <div className="confirm-form">
          <label>
            <span>Endereço</span>
            <input readOnly value={payload.url}/>
          </label>
          <label>
            <span>Arquivo</span>
            <input readOnly value={preview?.fileName||(loading?"Consultando...":"Arquivo desconhecido")}/>
          </label>
          
          <div className="confirm-save-row">
            <label style={{ flex: 1 }}>
              <span>Salvar em</span>
              <div style={{ display: "flex", width: "100%" }}>
                <input value={destination} onChange={event=>setDestination(event.target.value)}/>
                <button title="Escolher pasta" onClick={async()=>{const path=await open({directory:true});if(typeof path==="string")setDestination(path)}}><FolderOpen/></button>
              </div>
            </label>
            <div className="confirm-file-info">
              <FileIcon extension={preview?.extension??null}/>
              <strong>{loading?"Consultando...":bytes(preview?.fileSize??null)}</strong>
            </div>
          </div>
          
          <div className="confirm-details">
            <span>{preview?.extension?.toUpperCase()||"ARQUIVO"}</span>
            <span>{preview?.mimeType||"Tipo não informado"}</span>
          </div>

          {/* Chavinha de Permissão de Retomada */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "12px", borderTop: "1px solid var(--line)", paddingTop: "12px" }}>
            <span style={{ color: "#aab2a4", fontSize: "11px" }}>Permitir retomar downloads parados/cancelados</span>
            <button 
              type="button" 
              className={`mini-toggle ${resumeSupport ? "mini-toggle--on" : ""}`}
              onClick={() => setResumeSupport(!resumeSupport)}
              style={{ flex: "0 0 auto", width: "30px", height: "16px", cursor: "pointer", position: "relative" }}
            >
              <i style={{ 
                position: "absolute", 
                top: "2px", 
                left: resumeSupport ? "16px" : "2px", 
                width: "12px", 
                height: "12px", 
                borderRadius: "50%", 
                background: resumeSupport ? "var(--accent)" : "#818896", 
                transition: "left 0.15s ease, background 0.15s ease" 
              }} />
            </button>
          </div>
        </div>

        {error&&<p className="confirm-error">{error}</p>}
        
        <footer>
          <button onClick={close}>Cancelar</button>
          <button disabled={busy||loading||!preview} onClick={()=>void finish("later")}><Clock3/>Baixar depois</button>
          <button className="accent" disabled={busy||loading||!preview} onClick={()=>void finish("now")}><Download/>{busy?"Iniciando...":"Baixar agora"}</button>
        </footer>
      </section>
    </main>
  );
}
