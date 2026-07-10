import type { AppSettings, GradientConfig, GradientStop } from "../domain/settings";

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hexToHsl(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean.split("").map((c) => c + c).join("")
      : clean.padEnd(6, "0").slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  let hue = 0;
  let sat = 0;
  const delta = max - min;
  if (delta !== 0) {
    sat = light > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    switch (max) {
      case r: hue = ((g - b) / delta) % 6; break;
      case g: hue = (b - r) / delta + 2; break;
      default: hue = (r - g) / delta + 4; break;
    }
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return [hue, sat, light];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Intensidade (0-100) controla a saturação das cores do gradiente.
function applyIntensity(color: string, intensity: number): string {
  const [h, s, l] = hexToHsl(color);
  const factor = 0.45 + (clamp(intensity, 0, 100) / 100) * 0.85;
  return hslToHex(h, clamp(s * factor, 0, 1), l);
}

export function buildGradient(config: GradientConfig): string {
  const stops: GradientStop[] = (config.stops ?? [])
    .map((stop) => ({
      color: applyIntensity(stop.color || "#888888", config.intensity),
      position: clamp(stop.position ?? 0, 0, 100),
    }))
    .sort((a, b) => a.position - b.position);
  const safeStops =
    stops.length >= 2
      ? stops
      : stops.length === 1
        ? [stops[0], { ...stops[0], position: 100 }]
        : [
            { color: applyIntensity("#888888", config.intensity), position: 0 },
            { color: applyIntensity("#888888", config.intensity), position: 100 },
          ];
  const body = safeStops
    .map((stop) => `${stop.color} ${Math.round(stop.position)}%`)
    .join(", ");
  return config.type === "radial"
    ? `radial-gradient(circle at 30% 20%, ${body})`
    : `linear-gradient(${clamp(config.angle, 0, 360)}deg, ${body})`;
}

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

  const bgFill = settings.interfaceGradient.enabled
    ? buildGradient(settings.interfaceGradient)
    : p.bg;
  root.setProperty("--bg-fill", bgFill);
  // Superfícies da janela ficam transparentes quando o gradiente de interface
  // está ativo, deixando o gradiente único do .window-frame aparecer de forma
  // contínua (titlebar + sidebar + conteúdo formam um só gradiente).
  root.setProperty(
    "--bg-surface",
    settings.interfaceGradient.enabled ? "transparent" : p.panel,
  );
}
