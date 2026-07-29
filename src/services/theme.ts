import type { AppSettings, GradientConfig, GradientStop } from "../domain/settings";

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
  let r = 0; let g = 0; let b = 0;
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

const accentColors: Record<string, { base: string; strong: string; soft: string }> = {
  ember:   { base: "#f0883e", strong: "#faa53c", soft: "rgba(240,136,62,0.14)" },
  amber:   { base: "#f0b232", strong: "#f7c948", soft: "rgba(240,178,50,0.14)" },
  green:   { base: "#3ba55d", strong: "#4cc47a", soft: "rgba(59,165,93,0.14)" },
  red:     { base: "#ed4245", strong: "#f5565a", soft: "rgba(237,66,69,0.14)" },
  blue:    { base: "#4a90d9", strong: "#5fa3e8", soft: "rgba(74,144,217,0.14)" },
  violet:  { base: "#a06cd5", strong: "#b485e0", soft: "rgba(160,108,213,0.14)" },
};

export function applyThemeSettings(settings: AppSettings): void {
  const root = document.documentElement;
  root.dataset.appColor = settings.appColor;
  root.style.setProperty("--ui-scale", `${settings.uiScale}`);

  const a = accentColors[settings.accentColor] ?? accentColors.ember;
  root.style.setProperty("--ember", a.base);
  root.style.setProperty("--ember-strong", a.strong);
  root.style.setProperty("--ember-soft", a.soft);

  const bgFill = settings.interfaceGradient.enabled
    ? buildGradient(settings.interfaceGradient)
    : "var(--bg)";
  root.style.setProperty("--bg-fill", bgFill);
  root.style.setProperty(
    "--bg-surface",
    settings.interfaceGradient.enabled ? "transparent" : "var(--panel)",
  );
}