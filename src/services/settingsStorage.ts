import { defaultSettings, type AppSettings } from "../domain/settings";
import { emit } from "@tauri-apps/api/event";

const SETTINGS_KEY = "sf-downloader.settings.v1";

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(settings: AppSettings): void {
  const json = JSON.stringify(settings);
  localStorage.setItem(SETTINGS_KEY, json);
  try {
    window.dispatchEvent(
      new StorageEvent("storage", { key: SETTINGS_KEY, newValue: json }),
    );
  } catch {}
  void emit("settings-changed", settings).catch(() => {});
}
