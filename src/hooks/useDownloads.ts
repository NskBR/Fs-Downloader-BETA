import { useEffect,useRef,useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { DownloadProgress,DownloadTask } from "../domain/download";
import type { AppSettings } from "../domain/settings";
import * as service from "../services/downloadService";

export function useDownloads(settings:AppSettings){
 const[downloads,setDownloads]=useState<DownloadTask[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[completed,setCompleted]=useState<DownloadTask|null>(null);
 const latest=useRef(new Map<string,DownloadProgress>());
 useEffect(()=>{service.listDownloads().then(setDownloads).catch(()=>setError("Não foi possível carregar os downloads persistidos.")).finally(()=>setLoading(false));const progressListener=listen<DownloadProgress>("download-progress",({payload})=>{latest.current.set(payload.id,payload);setDownloads(items=>{const previous=items.find(i=>i.id===payload.id);const known=items.some(i=>i.id===payload.id);const next=known?items.map(i=>i.id===payload.id?{...i,totalDownloaded:payload.downloaded,fileSize:payload.total??i.fileSize,speedCurrent:payload.speed,status:payload.status}:i):items;if(payload.status==="completed"&&previous?.status!=="completed")setCompleted(next.find(i=>i.id===payload.id)??null);return next});if(payload.error)setError(payload.error)});const createdListener=listen<DownloadTask>("download-created",({payload})=>setDownloads(items=>items.some(i=>i.id===payload.id)?items:[payload,...items]));return()=>{void progressListener.then(dispose=>dispose());void createdListener.then(dispose=>dispose())}},[]);
 const start=async(url:string,root?:string)=>{setError(null);const task=await service.startDownload(url,settings,root);const progress=latest.current.get(task.id);const current=progress?{...task,totalDownloaded:progress.downloaded,fileSize:progress.total??task.fileSize,speedCurrent:progress.speed,status:progress.status}:task;setDownloads(items=>items.some(i=>i.id===current.id)?items:[current,...items])};
 const queue=async(url:string,root?:string)=>{const task=await service.queueDownload(url,settings,root);setDownloads(items=>[task,...items])};
 const remove=async(ids:string[])=>{await Promise.all(ids.map(service.removeDownload));setDownloads(items=>items.filter(i=>!ids.includes(i.id)))};
 const cancel=async(id:string)=>{if(await service.cancelDownload(id))setDownloads(items=>items.map(i=>i.id===id?{...i,status:"cancelled",speedCurrent:0}:i));else setError("O download não está mais ativo.")};
 const pause=async(id:string)=>{if(await service.pauseDownload(id))setDownloads(items=>items.map(i=>i.id===id?{...i,status:"paused",speedCurrent:0}:i));else setError("O download não está mais ativo.")};
 const resume=async(id:string)=>{try{await service.resumeDownload(id);setDownloads(items=>items.map(i=>i.id===id?{...i,status:"downloading"}:i))}catch(cause){setError(typeof cause==="string"?cause:"Não foi possível retomar o download.")}};
 return{downloads,loading,error,setError,start,queue,remove,cancel,pause,resume,completed,dismissCompleted:()=>setCompleted(null)};
}
