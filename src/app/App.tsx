import { useEffect, useRef, useState } from "react";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { AppShell } from "../components/layout/AppShell";
import { SettingsPage } from "../pages/SettingsPage";
import { DownloadsPage } from "../pages/DownloadsPage";
import { useSettings } from "../hooks/useSettings";
import { isPageId, type PageId } from "./navigation";
import * as downloadService from "../services/downloadService";
interface BrowserDownloadRequest { requestId:string;url:string;fileName:string|null;fileSize:number|null;mimeType:string|null }
const categoryPages:PageId[]=["downloads","active","completed","documents","music","videos","archives","applications"];
const normalizePage=(page:PageId):PageId=>({home:"active",downloads:"active",organization:"settings"} as Partial<Record<PageId,PageId>>)[page]??page;
const pageFromHash = (): PageId => { const hash = location.hash.slice(1); if(isPageId(hash))return normalizePage(hash); const saved=localStorage.getItem("sf-downloader.last-page")??""; return isPageId(saved)?normalizePage(saved):"active"; };
export function App() {
  const [activePage, setActivePage] = useState<PageId>(pageFromHash);
  const previousPage=useRef<PageId>("active");
  const { settings, persist, saved } = useSettings();
  const processedLinks=useRef(new Set<string>(JSON.parse(sessionStorage.getItem("sf-downloader.processed-links")||"[]")));
  useEffect(()=>{document.documentElement.dataset.theme=settings.theme},[settings.theme]);
  useEffect(()=>{void getCurrentWebview().setZoom(settings.uiScale).catch(console.error)},[settings.uiScale]);
  useEffect(() => { const handler = () => setActivePage(pageFromHash()); addEventListener("hashchange", handler); return () => removeEventListener("hashchange", handler); }, []);
  const navigate = (page: PageId) => { if(page!=="settings")previousPage.current=page;localStorage.setItem("sf-downloader.last-page",page); location.hash = page; setActivePage(page); };
  useEffect(()=>{let dispose:(()=>void)|undefined;const receive=(urls:string[])=>{for(const raw of urls){if(processedLinks.current.has(raw))continue;try{const link=new URL(raw);const target=link.searchParams.get("url");if(link.protocol!=="sfdownloader:"||link.hostname!=="download"||!target||!/^https?:\/\//i.test(target))continue;processedLinks.current.add(raw);sessionStorage.setItem("sf-downloader.processed-links",JSON.stringify([...processedLinks.current]));localStorage.setItem("sf-downloader.pending-browser-url",target);navigate("active");window.setTimeout(()=>window.dispatchEvent(new CustomEvent("sf-download-request",{detail:target})),0)}catch{continue}}};void getCurrent().then(urls=>{if(urls)receive(urls)});void onOpenUrl(receive).then(unlisten=>{dispose=unlisten});return()=>dispose?.()},[]);
  useEffect(()=>{let dispose:(()=>void)|undefined;void listen<BrowserDownloadRequest>("browser-download-request",async({payload})=>{const extension=payload.fileName?.split(".").pop()?.toLowerCase()||null;localStorage.setItem("sf-downloader.confirmation",JSON.stringify({url:payload.url,destination:settings.rootDownloadFolder,requestId:payload.requestId,preview:{url:payload.url,fileName:payload.fileName||"download",fileSize:payload.fileSize,mimeType:payload.mimeType,extension}}));navigate("active");await downloadService.openDownloadConfirmation()}).then(unlisten=>{dispose=unlisten});return()=>dispose?.()},[settings.rootDownloadFolder]);
  const content = activePage === "settings" ? <SettingsPage settings={settings} onSave={persist} saved={saved} onBack={()=>navigate(previousPage.current)} />
    : <DownloadsPage settings={settings} filter={categoryPages.includes(activePage)?activePage:"active"} />;
  return <AppShell activePage={activePage} onNavigate={navigate} hideSidebar={activePage==="settings"}>{content}</AppShell>;
}
