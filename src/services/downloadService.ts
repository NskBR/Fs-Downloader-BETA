import { invoke } from "@tauri-apps/api/core";
import type { DownloadTask } from "../domain/download";
import type { AppSettings } from "../domain/settings";

export interface DownloadPreview { url:string; fileName:string; fileSize:number|null; mimeType:string|null; extension:string|null }
const input=(url:string,settings:AppSettings,rootFolder?:string,browserRequestId?:string,resumeSupport:boolean=true)=>({url,rootFolder:rootFolder||settings.rootDownloadFolder,autoOrganize:settings.autoOrganizeEnabled,maxConnections:settings.maxConnectionsPerDownload,maxParallelDownloads:settings.maxParallelDownloads,speedLimitDownload:Math.max(0,Math.round(settings.speedLimitDownloadMbps*1024*1024)),browserRequestId:browserRequestId||null,resumeSupport});
export const listDownloads=()=>invoke<DownloadTask[]>("list_downloads");
export const inspectDownload=(url:string)=>invoke<DownloadPreview>("inspect_download",{url});
export const openDownloadConfirmation=()=>invoke<void>("open_download_confirmation");
export const openProgressWindow=(id:string)=>invoke<void>("open_progress_window",{id});
export const startDownload=(url:string,settings:AppSettings,rootFolder?:string,browserRequestId?:string,resumeSupport?:boolean)=>invoke<DownloadTask>("start_download",{input:input(url,settings,rootFolder,browserRequestId,resumeSupport)});
export const queueDownload=(url:string,settings:AppSettings,rootFolder?:string,browserRequestId?:string,resumeSupport?:boolean)=>invoke<DownloadTask>("queue_download",{input:input(url,settings,rootFolder,browserRequestId,resumeSupport)});
export const cancelDownload=(id:string)=>invoke<boolean>("cancel_download",{id});
export const pauseDownload=(id:string)=>invoke<boolean>("pause_download",{id});
export const resumeDownload=(id:string)=>invoke<DownloadTask>("resume_download",{id});
export const replaceDownloadUrl=(id:string,newUrl:string)=>invoke<DownloadTask>("replace_download_url",{id,newUrl});
export const removeDownload=(id:string)=>invoke<boolean>("remove_download",{id});
export const revealInFolder=(path:string)=>invoke<void>("reveal_in_folder",{path});
export const openFile=(path:string)=>invoke<void>("open_file",{path});
export const updateSpeedLimit=(id:string,speedLimit:number)=>invoke<void>("update_speed_limit",{id,speedLimit});
export const browserExtensionConnected=()=>invoke<boolean>("browser_extension_status");
