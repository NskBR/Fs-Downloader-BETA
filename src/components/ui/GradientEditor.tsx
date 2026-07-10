import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { GradientConfig, GradientStop } from "../../domain/settings";
import { buildGradient } from "../../services/theme";

interface Props {
  config: GradientConfig;
  onChange: (config: GradientConfig) => void;
  label: string;
  presets: GradientConfig[];
}

export function GradientEditor({ config, onChange, label, presets }: Props) {
  const [custom, setCustom] = useState(false);

  const set = (patch: Partial<GradientConfig>) =>
    onChange({ ...config, ...patch });

  const applyPreset = (preset: GradientConfig) => {
    set({
      enabled: true,
      type: preset.type,
      angle: preset.angle,
      intensity: preset.intensity,
      stops: preset.stops.map((stop) => ({ ...stop })),
    });
  };

  const setStop = (index: number, patch: Partial<GradientStop>) => {
    const stops = config.stops.map((stop, i) =>
      i === index ? { ...stop, ...patch } : stop,
    );
    set({ stops });
  };

  const addStop = () => {
    const last = config.stops[config.stops.length - 1];
    const position = last ? Math.min(100, last.position + 10) : 50;
    const color = last ? last.color : "#ffffff";
    set({ stops: [...config.stops, { color, position }] });
  };

  const removeStop = (index: number) => {
    if (config.stops.length <= 2) return;
    set({ stops: config.stops.filter((_, i) => i !== index) });
  };

  const preview = buildGradient(config);

  return (
    <div className="gradient-editor">
      <label className="gradient-toggle">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(event) =>
            onChange({ ...config, enabled: event.target.checked })
          }
        />
        <span>Ativar gradiente de {label}</span>
      </label>

      <div className="gradient-preview" style={{ background: preview }} />

      {config.enabled && (
        <div className="gradient-controls">
          <div className="gradient-presets">
            {presets.map((preset, index) => (
              <button
                key={index}
                type="button"
                className="gradient-preset"
                title="Aplicar este gradiente"
                style={{ background: buildGradient(preset) }}
                onClick={() => applyPreset(preset)}
              />
            ))}
          </div>

          <button
            type="button"
            className="gradient-custom-toggle"
            onClick={() => setCustom((value) => !value)}
          >
            {custom ? "Ocultar personalização" : "Gradiente personalizado"}
          </button>

          {custom && (
            <div className="gradient-custom">
              <div className="gradient-row">
                <span>Tipo</span>
                <div className="gradient-segmented">
                  {(["linear", "radial"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      className={config.type === type ? "active" : ""}
                      onClick={() => set({ type })}
                    >
                      {type === "linear" ? "Linear" : "Radial"}
                    </button>
                  ))}
                </div>
              </div>

              {config.type === "linear" && (
                <div className="gradient-row">
                  <span>Direção</span>
                  <div className="gradient-slider">
                    <input
                      type="range"
                      min={0}
                      max={360}
                      value={config.angle}
                      onChange={(event) =>
                        set({ angle: Number(event.target.value) })
                      }
                    />
                    <b>{config.angle}°</b>
                  </div>
                </div>
              )}

              <div className="gradient-row">
                <span>Intensidade</span>
                <div className="gradient-slider">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={config.intensity}
                    onChange={(event) =>
                      set({ intensity: Number(event.target.value) })
                    }
                  />
                  <b>{config.intensity}%</b>
                </div>
              </div>

              <div className="gradient-stops">
                {config.stops.map((stop, index) => (
                  <div className="gradient-stop" key={index}>
                    <input
                      type="color"
                      value={stop.color}
                      onChange={(event) =>
                        setStop(index, { color: event.target.value })
                      }
                      aria-label={`Cor ${index + 1}`}
                    />
                    <div className="gradient-slider">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={stop.position}
                        onChange={(event) =>
                          setStop(index, { position: Number(event.target.value) })
                        }
                      />
                      <b>{stop.position}%</b>
                    </div>
                    <button
                      type="button"
                      className="gradient-stop-remove"
                      onClick={() => removeStop(index)}
                      disabled={config.stops.length <= 2}
                      title="Remover cor"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="gradient-add"
                  onClick={addStop}
                >
                  <Plus size={13} /> Adicionar cor
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
