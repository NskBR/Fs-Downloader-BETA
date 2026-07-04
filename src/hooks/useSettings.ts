import { useEffect, useState } from "react";
import type { AppSettings } from "../domain/settings";
import { loadSettings, saveSettings } from "../services/settingsStorage";

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 2400);
    return () => window.clearTimeout(timer);
  }, [saved]);

  const persist = (next: AppSettings) => {
    saveSettings(next);
    setSettings(next);
    setSaved(true);
  };

  return { settings, setSettings, persist, saved };
}
