import { Archive, CheckCircle2, Clock3, FileText, Grid2X2, History, Menu, Music2, Settings, Video } from "lucide-react";
import { useState, type PropsWithChildren } from "react";
import type { PageId } from "../../app/navigation";
import { TitleBar } from "./TitleBar";
import logo from "../../assets/sf-logo.png";
interface Props extends PropsWithChildren { activePage:PageId; onNavigate:(page:PageId)=>void; hideSidebar?:boolean; }
const sections=[
  {key:"active",label:"Ativos",icon:Clock3,page:"active" as PageId},
  {key:"completed",label:"Concluídos",icon:CheckCircle2,page:"completed" as PageId},
  {key:"history",label:"Histórico",icon:History,page:"history" as PageId},
  {key:"documents",label:"Documentos",icon:FileText,page:"documents" as PageId},
  {key:"music",label:"Músicas",icon:Music2,page:"music" as PageId},
  {key:"videos",label:"Vídeos",icon:Video,page:"videos" as PageId},
  {key:"archives",label:"Compactados",icon:Archive,page:"archives" as PageId},
  {key:"applications",label:"Aplicativos",icon:Grid2X2,page:"applications" as PageId},
];
export function AppShell({activePage,onNavigate,children,hideSidebar=false}:Props){const[open,setOpen]=useState(false);const navigate=(page:PageId)=>{onNavigate(page);setOpen(false)};return <div className={`window-frame ${hideSidebar?"window-frame--standalone":""}`}><TitleBar/><div className={`app-shell ${hideSidebar?"app-shell--standalone":""}`}>{!hideSidebar&&<><button className="mobile-menu" onClick={()=>setOpen(true)} aria-label="Abrir menu"><Menu size={21}/></button>{open&&<button className="sidebar-backdrop" onClick={()=>setOpen(false)} aria-label="Fechar menu"/>}<aside className={`sidebar ${open?"sidebar--open":""}`}><button className="brand" title="SF Downloader" onClick={()=>navigate("active")}><img className="brand__logo" src={logo} alt="SF Downloader"/></button><nav className="navigation" aria-label="Navegação principal">{sections.map(({key,label,icon:Icon,page})=><button key={key} className={`navigation__item ${activePage===page?"navigation__item--active":""}`} onClick={()=>navigate(page)}><Icon size={21}/><span>{label}</span></button>)}</nav><button className={`settings-link ${activePage==="settings"?"settings-link--active":""}`} onClick={()=>navigate("settings")}><Settings size={21}/><span>Configurações</span></button></aside></>}<main className="main-content">{children}</main></div></div>}
