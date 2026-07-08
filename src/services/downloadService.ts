import { invoke } from "@tauri-apps/api/core";
import type { DownloadTask } from "../domain/download";
import type { AppSettings } from "../domain/settings";
import type { ProfileStatistics } from "../domain/profile";

export interface DownloadPreview {
  url: string;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  extension: string | null;
}
const input = (
  url: string,
  settings: AppSettings,
  rootFolder?: string,
  browserRequestId?: string,
  resumeSupport: boolean = true,
  autoExtract = false,
  archivePassword?: string,
  selectedCategory?: string,
  force = false,
) => ({
  url,
  rootFolder: rootFolder || settings.rootDownloadFolder,
  autoOrganize: settings.autoOrganizeEnabled,
  maxConnections: settings.maxConnectionsPerDownload,
  maxParallelDownloads: settings.maxParallelDownloads,
  speedLimitDownload: Math.max(
    0,
    Math.round(settings.speedLimitDownloadMbps * 1024 * 1024),
  ),
  browserRequestId: browserRequestId || null,
  resumeSupport,
  autoExtract,
  archivePassword: archivePassword || null,
  selectedCategory: selectedCategory || null,
  force,
});
export const listDownloads = () => invoke<DownloadTask[]>("list_downloads");
export const inspectDownload = (url: string) =>
  invoke<DownloadPreview>("inspect_download", { url });
export const openDownloadConfirmation = (token: string) =>
  invoke<void>("open_download_confirmation", { token });
export const openProgressWindow = (id: string) =>
  invoke<void>("open_progress_window", { id });
export const openCompleteWindow = (id: string) =>
  invoke<void>("open_complete_window", { id });
export const startDownload = (
  url: string,
  settings: AppSettings,
  rootFolder?: string,
  browserRequestId?: string,
  resumeSupport?: boolean,
  autoExtract = false,
  archivePassword?: string,
  selectedCategory?: string,
  force = false,
) =>
  invoke<DownloadTask>("start_download", {
    input: input(
      url,
      settings,
      rootFolder,
      browserRequestId,
      resumeSupport,
      autoExtract,
      archivePassword,
      selectedCategory,
      force,
    ),
  });
export const queueDownload = (
  url: string,
  settings: AppSettings,
  rootFolder?: string,
  browserRequestId?: string,
  resumeSupport?: boolean,
  autoExtract = false,
  archivePassword?: string,
  selectedCategory?: string,
) =>
  invoke<DownloadTask>("queue_download", {
    input: input(
      url,
      settings,
      rootFolder,
      browserRequestId,
      resumeSupport,
      autoExtract,
      archivePassword,
      selectedCategory,
    ),
  });
export const cancelDownload = (id: string, deleteFiles = false) =>
  invoke<boolean>("cancel_download", { id, deleteFiles });
export const pauseDownload = (id: string) =>
  invoke<boolean>("pause_download", { id });
export const resumeDownload = (id: string) =>
  invoke<DownloadTask>("resume_download", { id });
export const replaceDownloadUrl = (id: string, newUrl: string) =>
  invoke<DownloadTask>("replace_download_url", { id, newUrl });
export const removeDownload = (id: string) =>
  invoke<boolean>("remove_download", { id });
export const revealInFolder = (path: string) =>
  invoke<void>("reveal_in_folder", { path });
export const openFile = (path: string) => invoke<void>("open_file", { path });
export const updateSpeedLimit = (id: string, speedLimit: number) =>
  invoke<void>("update_speed_limit", { id, speedLimit });
export const browserExtensionConnected = () =>
  invoke<boolean>("browser_extension_status");
export const extractionStatus = (id: string) =>
  invoke<string | null>("extraction_status", { id });
export const openUrl = (url: string) => invoke<void>("open_url", { url });
export const profileStatistics = () =>
  invoke<ProfileStatistics>("profile_statistics");
