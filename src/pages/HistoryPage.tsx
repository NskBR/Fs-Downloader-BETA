import { invoke } from "@tauri-apps/api/core";
import { CheckSquare,ExternalLink,FolderOpen,Search,Square,Trash2 } from "lucide-react";
import { useEffect,useMemo,useState } from "react";

interface HistoryItem{id:string;fileName:string;fileSize:number|null;status:string;sourceUrl:string|null;path:string;durationSeconds:number|null;averageSpeed:number|null;createdAt:string}
const size=(n:number|null)=>{if(n===null)return"—";const u=["B","KB","MB","GB","TB"];let v=n,i=0;while(v>=1024&&i<4){v/=1024;i++}return`${v.toFixed(i?1:0)} ${u[i]}`};
export function HistoryPage(){
 const[items,setItems]=useState<HistoryItem[]>([]),[selected,setSelected]=useState<Set<string>>(new Set()),[search,setSearch]=useState(""),[filter,setFilter]=useState("all"),[error,setError]=useState<string|null>(null);
 const load=()=>invoke<HistoryItem[]>("list_history").then(setItems).catch(e=>setError(String(e)));useEffect(()=>{void load()},[]);
 const visible=useMemo(()=>items.filter(i=>(filter==="all"||i.status===filter)&&i.fileName.toLowerCase().includes(search.toLowerCase())),[items,filter,search]);
 const toggle=(id:string)=>setSelected(value=>{const next=new Set(value);next.has(id)?next.delete(id):next.add(id);return next});
 const remove=async()=>{await Promise.all([...selected].map(id=>invoke("remove_history_item",{id})));setSelected(new Set());load()};
 const clear=async(status?:string)=>{if(!confirm(status?"Limpar estes itens do histórico?":"Limpar todo o histórico?"))return;await invoke("clear_history",{status:status||null});load()};
 return <section className="history-page"><header className="section-heading"><div><span>ARQUIVO DE ATIVIDADE</span><h1>Histórico</h1><p>O que passou por aqui, com ações que realmente funcionam.</p></div><button className="danger-button" onClick={()=>clear()}><Trash2/>Limpar tudo</button></header>
 <div className="history-tools"><div className="segmented">{[["all","Todos"],["completed","Concluídos"],["failed","Falhas"],["cancelled","Cancelados"]].map(([id,label])=><button className={filter===id?"active":""} onClick={()=>setFilter(id)} key={id}>{label}</button>)}</div><label className="toolbar-search"><Search/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar no histórico"/></label></div>
 {error&&<div className="error-banner">{error}</div>}<div className="history-list">{visible.length===0?<div className="empty-compact"><strong>Nenhum registro encontrado</strong></div>:visible.map(item=><article className={`history-row ${selected.has(item.id)?"selected":""}`} key={item.id} onClick={()=>toggle(item.id)}><button className="check-button">{selected.has(item.id)?<CheckSquare/>:<Square/>}</button><div><strong>{item.fileName}</strong><span>{new Date(item.createdAt).toLocaleString("pt-BR")} · {size(item.fileSize)} · {item.status}</span></div><div className="history-actions" onClick={e=>e.stopPropagation()}><button title="Abrir arquivo" onClick={()=>invoke("open_file",{path:item.path}).catch(e=>setError(String(e)))}><ExternalLink/></button><button title="Abrir pasta" onClick={()=>invoke("reveal_in_folder",{path:item.path}).catch(e=>setError(String(e)))}><FolderOpen/></button></div></article>)}</div>
 <footer className="selection-bar"><span>{selected.size} selecionado(s)</span><button disabled={!selected.size} onClick={remove}><Trash2/>Apagar selecionados</button><button onClick={()=>clear("completed")}>Limpar concluídos</button><button onClick={()=>clear("failed")}>Limpar falhas</button></footer></section>
}
