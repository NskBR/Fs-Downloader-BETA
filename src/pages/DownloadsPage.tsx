import { AlertTriangle, Ban, CheckCircle2, CheckSquare, Clock3, ExternalLink, FolderOpen, Link2, MoreVertical, Pause, Play, Plus, Search, ShieldCheck, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { FileIcon } from "../components/downloads/FileIcon";
import type { AppSettings } from "../domain/settings";
import type { PageId } from "../app/navigation";
import { useDownloads } from "../hooks/useDownloads";
import * as service from "../services/downloadService";
import type { DownloadTask } from "../domain/download";

const bytes=(value:number|null)=>{if(value===null)return"—";const units=["B","KB","MB","GB","TB"];let size=value,index=0;while(size>=1024&&index<4){size/=1024;index++}return`${size.toFixed(index?1:0)} ${units[index]}`};
const labels:Record<string,string>={pending:"Preparando",downloading:"Baixando",completed:"Concluído",failed:"Falhou",cancelled:"Cancelado",paused:"Pausado"};
const groups:Partial<Record<PageId,string[]>>={documents:["pdf","doc","docx","xls","xlsx","ppt","pptx","txt","csv"],music:["mp3","wav","flac","ogg","m4a","aac"],videos:["mp4","mkv","mov","avi","webm"],archives:["zip","rar","7z","tar","gz"],applications:["exe","msi","apk","bat","appimage","dmg","pkg"]};

export function DownloadsPage({settings,filter}:{settings:AppSettings;filter:PageId}){
  const [url,setUrl]=useState("");
  const [search,setSearch]=useState("");
  const [starting,setStarting]=useState(false);
  const [composer,setComposer]=useState(false);
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [columns,setColumns]=useState<number[]>(()=>{try{return JSON.parse(localStorage.getItem("sf-downloader.columns")||"[170,100]")}catch{return[170,100]}});
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    downloadId: string;
    status: string;
    filePath: string;
  } | null>(null);

  const {downloads,loading,error,setError,remove,cancel,pause,resume}=useDownloads(settings);
  const drag=useRef<{index:number;x:number;width:number}|null>(null);

  const inspect=async(raw:string)=>{if(!raw.trim())return;setStarting(true);setError(null);try{localStorage.setItem("sf-downloader.confirmation",JSON.stringify({url:raw.trim(),destination:settings.rootDownloadFolder}));await service.openDownloadConfirmation();setUrl("");setComposer(false)}catch(cause){setError(String(cause))}finally{setStarting(false)}};
  
  useEffect(()=>{const receive=(event:Event)=>{const value=(event as CustomEvent<string>).detail||localStorage.getItem("sf-downloader.pending-browser-url");if(!value)return;localStorage.removeItem("sf-downloader.pending-browser-url");void inspect(value)};window.addEventListener("sf-download-request",receive);const pending=localStorage.getItem("sf-downloader.pending-browser-url");if(pending)receive(new CustomEvent("sf-download-request",{detail:pending}));return()=>window.removeEventListener("sf-download-request",receive)},[settings.rootDownloadFolder]);
  useEffect(()=>{localStorage.setItem("sf-downloader.columns",JSON.stringify(columns))},[columns]);
  
  useEffect(()=>{const move=(event:MouseEvent)=>{const current=drag.current;if(!current)return;setColumns(old=>old.map((value,index)=>index===current.index?Math.min(index===0?260:180,Math.max(index===0?115:75,current.width+event.clientX-current.x)):value))};const up=()=>drag.current=null;addEventListener("mousemove",move);addEventListener("mouseup",up);return()=>{removeEventListener("mousemove",move);removeEventListener("mouseup",up)}},[]);

  // Fechar o menu de contexto ao clicar em qualquer lugar
  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  const handleContextMenu = (e: React.MouseEvent, item: DownloadTask) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      downloadId: item.id,
      status: item.status,
      filePath: item.finalPath
    });
  };

  const submit=(event:FormEvent)=>{event.preventDefault();void inspect(url)};
  
  const replaceLink=async(id:string)=>{const value=prompt("Cole a nova URL para este arquivo:");if(!value)return;setError(null);try{await service.replaceDownloadUrl(id,value.trim());await resume(id)}catch(cause){setError(String(cause))}};
  
  const visible=downloads.filter(item=>{if(filter==="active"&&!['pending','downloading','paused','failed'].includes(item.status))return false;if(filter==="completed"&&item.status!=="completed")return false;const extensions=groups[filter];if(extensions&&!extensions.includes(item.extension?.toLowerCase()??""))return false;return item.fileName.toLowerCase().includes(search.toLowerCase())});
  
  const toggle=(id:string)=>setSelected(value=>{const next=new Set(value);next.has(id)?next.delete(id):next.add(id);return next});
  const picked=downloads.filter(item=>selected.has(item.id));
  const style={"--date-width":`${columns[0]}px`,"--size-width":`${columns[1]}px`} as CSSProperties;
  
  return <section className="downloads-workspace">
   <div className="reference-toolbar"><button className="new-download-button" onClick={()=>setComposer(value=>!value)}><Plus/>Novo</button><button className="toolbar-action" disabled={!selected.size} onClick={()=>void remove([...selected]).then(()=>setSelected(new Set()))}><Trash2/>Excluir</button><button className="toolbar-action" disabled={picked.length!==1||picked[0].status!=="completed"} onClick={()=>void service.openFile(picked[0].finalPath)}><ExternalLink/>Abrir</button><button className="toolbar-action" disabled={picked.length!==1} onClick={()=>void service.revealInFolder(picked[0].finalPath)}><FolderOpen/>Pasta</button><i className="toolbar-divider"/><label className="toolbar-search"><Search/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Buscar"/></label><button className="toolbar-more"><MoreVertical/></button></div>
   {composer&&<form className="url-composer" onSubmit={submit}><input type="url" required autoFocus placeholder="Cole a URL do arquivo" value={url} onChange={event=>setUrl(event.target.value)}/><button className="new-download-button" disabled={starting||!settings.rootDownloadFolder}>{starting?"Analisando...":"Continuar"}</button></form>}
   {!settings.rootDownloadFolder&&<div className="notice compact-notice"><AlertTriangle/><div><strong>Defina uma pasta nas configurações</strong></div></div>}{error&&<div className="error-banner">{error}</div>}
   <div className="reference-table" style={style}><div className="table-head"><span/><span/><span>Nome</span><span className="resizable">Data<i onMouseDown={event=>drag.current={index:0,x:event.clientX,width:columns[0]}}/></span><span className="resizable">Tamanho<i onMouseDown={event=>drag.current={index:1,x:event.clientX,width:columns[1]}}/></span><span/></div><div className="download-list">{loading?<div className="empty-compact">Carregando...</div>:visible.length===0?<div className="empty-compact"><FolderOpen/><strong>Nenhum arquivo</strong><span>Use Novo para adicionar uma URL.</span></div>:visible.map(item=>{const progress=item.fileSize?Math.min(100,item.totalDownloaded/item.fileSize*100):0;const resumable=["paused","failed","cancelled"].includes(item.status);return <article className={`reference-row ${selected.has(item.id)?"selected":""}`} key={item.id} onClick={()=>toggle(item.id)} onContextMenu={event=>handleContextMenu(event,item)}><button className="row-check">{selected.has(item.id)?<CheckSquare/>:<Square/>}</button><FileIcon extension={item.extension}/><div className="reference-name"><strong>{item.fileName}</strong>{item.status!=="completed"&&<><div className="progress-track"><i style={{width:`${progress}%`}}/></div><small>{labels[item.status]} · {bytes(item.totalDownloaded)} / {bytes(item.fileSize)} · {item.status==="downloading"?`${bytes(item.speedCurrent)}/s`:`${progress.toFixed(0)}%`}</small></>}</div><time>{new Date(item.createdAt).toLocaleDateString("pt-BR")}</time><span className="reference-size">{bytes(item.fileSize)}</span><div className="row-actions" onClick={event=>event.stopPropagation()}>{item.status==="downloading"&&<button title="Pausar" onClick={()=>void pause(item.id)}><Pause/></button>}{resumable&&<button title="Continuar" onClick={()=>void resume(item.id)}><Play/></button>}{["paused","failed"].includes(item.status)&&<button title="Fornecer novo link" onClick={()=>void replaceLink(item.id)}><Link2/></button>}{["pending","downloading","paused"].includes(item.status)&&<button title="Cancelar" onClick={()=>void cancel(item.id)}><Ban/></button>}</div></article>})}</div></div>
   <footer className="downloads-statusbar"><div><ShieldCheck/><span>Monitoramento</span><button className="mini-toggle mini-toggle--on"><i/></button></div><div><Clock3/><span>{selected.size?`${selected.size} selecionado(s)`:"Fila pronta"}</span></div><div className="statusbar-ok"><CheckCircle2/><span>{downloads.some(item=>item.status==="downloading")?"Baixando":"Tudo em dia"}</span></div></footer>

   {/* Menu de Contexto */}
   {contextMenu && (
     <div 
       className="context-menu" 
       style={{ 
         top: `${contextMenu.y}px`, 
         left: `${contextMenu.x}px` 
       }}
       onClick={e => e.stopPropagation()}
     >
       {contextMenu.status === "downloading" ? (
         <button className="context-menu-item" onClick={() => { pause(contextMenu.downloadId); setContextMenu(null); }}>
           Pausar download
         </button>
       ) : ["paused", "failed", "cancelled"].includes(contextMenu.status) ? (
         <button className="context-menu-item" onClick={() => { resume(contextMenu.downloadId); setContextMenu(null); }}>
           Retomar download
         </button>
       ) : null}

       <button 
         className="context-menu-item" 
         onClick={() => {
           const val = prompt("Digite o limite de velocidade para este download (em MB/s, 0 para ilimitado):");
           if (val !== null) {
             alert(`Limite de velocidade definido para ${val === "0" ? "ilimitado" : val + " MB/s"} (aplicado na próxima retomada).`);
           }
           setContextMenu(null);
         }}
       >
         Limitar velocidade
       </button>

       {["pending", "downloading", "paused"].includes(contextMenu.status) && (
         <button className="context-menu-item" onClick={() => { cancel(contextMenu.downloadId); setContextMenu(null); }}>
           Cancelar download
         </button>
       )}

       <div className="context-menu-divider" />

       <button className="context-menu-item" onClick={() => { service.revealInFolder(contextMenu.filePath); setContextMenu(null); }}>
         Abrir pasta de destino
       </button>

       {contextMenu.status === "completed" && (
         <button className="context-menu-item" onClick={() => { service.openFile(contextMenu.filePath); setContextMenu(null); }}>
           Abrir arquivo
         </button>
       )}

       <button className="context-menu-item danger" onClick={() => { remove([contextMenu.downloadId]); setContextMenu(null); }}>
         Excluir download
       </button>
     </div>
   )}
  </section>;
}
