import type { AppSettings } from "../domain/settings";

const accents: Record<string, { base: string; strong: string; soft: string }> = {
  ember:   { base: "#f0883e", strong: "#faa53c", soft: "rgba(240,136,62,0.14)" },
  amber:   { base: "#f0b232", strong: "#f7c948", soft: "rgba(240,178,50,0.14)" },
  green:   { base: "#3ba55d", strong: "#4cc47a", soft: "rgba(59,165,93,0.14)" },
  red:     { base: "#ed4245", strong: "#f5565a", soft: "rgba(237,66,69,0.14)" },
  blue:    { base: "#4a90d9", strong: "#5fa3e8", soft: "rgba(74,144,217,0.14)" },
  violet:  { base: "#a06cd5", strong: "#b485e0", soft: "rgba(160,108,213,0.14)" },
};

const palettes: Record<string, { bg: string; panel: string; surface: string; surface2: string; line: string; lineSoft: string }> = {
  slate:    { bg: "#16171a", panel: "#1f2024", surface: "#26282d", surface2: "#2e3036", line: "#34363c", lineSoft: "#2a2c31" },
  graphite: { bg: "#15171b", panel: "#1d2025", surface: "#24272d", surface2: "#2c3037", line: "#34373e", lineSoft: "#282b31" },
  obsidian: { bg: "#0c0d10", panel: "#15171c", surface: "#1c1f25", surface2: "#242832", line: "#2c313a", lineSoft: "#191c22" },
  mint:     { bg: "#121815", panel: "#1a201d", surface: "#212824", surface2: "#293230", line: "#323a35", lineSoft: "#1f2622" },
  ocean:    { bg: "#0f151b", panel: "#16212b", surface: "#1d2b38", surface2: "#263844", line: "#2e3e4c", lineSoft: "#19242f" },
  rose:     { bg: "#1a1417", panel: "#221a1e", surface: "#2a2127", surface2: "#332830", line: "#3a2e35", lineSoft: "#241c20" },
};

export function applyThemeSettings(settings: AppSettings): void {
  const root = document.documentElement.style;
  const a = accents[settings.accentColor] ?? accents.ember;
  root.setProperty("--ember", a.base);
  root.setProperty("--ember-strong", a.strong);
  root.setProperty("--ember-soft", a.soft);
  const p = palettes[settings.appColor] ?? palettes.slate;
  root.setProperty("--bg", p.bg);
  root.setProperty("--panel", p.panel);
  root.setProperty("--surface", p.surface);
  root.setProperty("--surface-2", p.surface2);
  root.setProperty("--line", p.line);
  root.setProperty("--line-soft", p.lineSoft);
}
