export type SpeedUnit = "Mbps" | "MB/s";
export type AppTheme = "midnight" | "graphite" | "light";

export interface AppSettings {
  rootDownloadFolder: string;
  autoOrganizeEnabled: boolean;
  defaultSpeedValue: number;
  defaultSpeedUnit: SpeedUnit;
  maxConnectionsPerDownload: number;
  maxParallelDownloads: number;
  speedLimitDownloadMbps: number;
  theme: AppTheme;
  uiScale: number;
}

export const defaultSettings: AppSettings = {
  rootDownloadFolder: "",
  autoOrganizeEnabled: true,
  defaultSpeedValue: 100,
  defaultSpeedUnit: "Mbps",
  maxConnectionsPerDownload: 8,
  maxParallelDownloads: 3,
  speedLimitDownloadMbps: 0,
  theme: "midnight",
  uiScale: 1.1,
};
