export type SpeedUnit = "Mbps" | "MB/s";
export type AppTheme = "system" | "midnight" | "graphite" | "light";
export type AppLanguage = "pt-BR" | "en-US";

export interface CustomCategory {
  id: string;
  name: string;
  extensions: string[];
}

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
  startInTrayMode: boolean;
  language: AppLanguage;
  customCategories: CustomCategory[];
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
  startInTrayMode: false,
  language: "pt-BR",
  customCategories: [],
};
