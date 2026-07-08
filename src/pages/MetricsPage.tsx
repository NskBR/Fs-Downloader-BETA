import { useCallback, useEffect, useState } from "react";
import { BarChart3, RotateCcw, RefreshCw, Download, Upload, AlertTriangle, X } from "lucide-react";
import { getMetrics, resetMetrics, exportMetrics, importMetrics } from "../services/downloadService";
import type { MetricsSnapshot } from "../domain/metrics";

const GB = 1024 * 1024 * 1024;

function formatBytes(value: number): string {
  if (value <= 0) return "0 GB";
  const gb = value / GB;
  if (gb >= 1) return `${gb.toFixed(gb >= 100 ? 0 : 1)} GB`;
  const mb = value / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) return "—";
  const mbps = bytesPerSecond / (1024 * 1024);
  if (mbps >= 1) return `${mbps.toFixed(mbps >= 100 ? 0 : 1)} MB/s`;
  const kbps = bytesPerSecond / 1024;
  return `${kbps.toFixed(0)} KB/s`;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "—";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return `${minutes}min${rest ? ` ${rest}s` : ""}`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return `${hours}h${rem ? ` ${rem}min` : ""}`;
}

interface Segment {
  label: string;
  value: number;
  color: string;
}

function Donut({ segments, centerLabel, centerValue }: {
  segments: Segment[];
  centerLabel: string;
  centerValue: string;
}) {
  const size = 160;
  const stroke = 20;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--line-soft)"
          strokeWidth={stroke}
        />
        {total > 0 &&
          segments.map((segment) => {
            if (segment.value <= 0) return null;
            const fraction = segment.value / total;
            const dash = fraction * circumference;
            const circle = (
              <circle
                key={segment.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={segment.color}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            );
            offset += dash;
            return circle;
          })}
      </svg>
      <div className="donut-center">
        <strong>{centerValue}</strong>
        <span>{centerLabel}</span>
      </div>
    </div>
  );
}

export function MetricsPage() {
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const load = useCallback(() => {
    void getMetrics()
      .then(setMetrics)
      .catch(() => setMetrics(null));
  }, []);

  useEffect(load, [load]);

  const handleConfirmReset = async () => {
    setResetting(true);
    try {
      await resetMetrics();
      setConfirmReset(false);
      load();
    } finally {
      setResetting(false);
    }
  };

  const handleExport = async (format: "json" | "txt") => {
    try {
      await exportMetrics(format);
    } catch {
      /* diálogo cancelado pelo usuário */
    }
  };

  const handleImport = async () => {
    try {
      await importMetrics();
      load();
    } catch {
      /* diálogo cancelado ou JSON inválido */
    }
  };

  const completedBytes = metrics?.completedBytes ?? 0;
  const cancelledBytes = metrics?.cancelledBytes ?? 0;
  const failedBytes = metrics?.failedBytes ?? 0;
  const completedCount = metrics?.completedCount ?? 0;
  const totalDurationMs = metrics?.totalDurationMs ?? 0;
  const averageSpeed =
    totalDurationMs > 0 ? completedBytes / (totalDurationMs / 1000) : 0;
  const averageTime = completedCount > 0 ? totalDurationMs / completedCount : 0;
  const statusTotal = completedBytes + cancelledBytes + failedBytes;

  const segments: Segment[] = [
    { label: "Concluído", value: completedBytes, color: "var(--accent-green)" },
    { label: "Cancelado", value: cancelledBytes, color: "var(--accent-amber)" },
    { label: "Falho", value: failedBytes, color: "var(--accent-red)" },
  ];

  const cards = [
    { label: "Concluído", value: formatBytes(completedBytes), accent: "green" },
    { label: "Cancelado", value: formatBytes(cancelledBytes), accent: "amber" },
    { label: "Falho", value: formatBytes(failedBytes), accent: "red" },
    { label: "Extraído", value: formatBytes(metrics?.extractedBytes ?? 0), accent: "ember" },
    { label: "SSD gravado", value: formatBytes(metrics?.ssdWrittenBytes ?? 0), accent: "slate" },
    { label: "Velocidade média", value: formatSpeed(averageSpeed), accent: "ember" },
    { label: "Tempo médio", value: formatDuration(averageTime), accent: "slate" },
  ];

  return (
    <section className="metrics-page">
      <header className="metrics-header">
        <div>
          <h1>Métricas</h1>
          <p>Estatísticas acumuladas de downloads — persistem até serem redefinidas.</p>
        </div>
        <div className="metrics-actions">
          <button
            className="reset-btn"
            onClick={handleImport}
            title="Importar métricas de um JSON"
            aria-label="Importar métricas"
          >
            <Upload size={15} />
            Importar
          </button>
          <button
            className="reset-btn"
            onClick={() => void handleExport("txt")}
            title="Baixar relatório em TXT"
            aria-label="Exportar métricas em TXT"
          >
            <Download size={15} />
            TXT
          </button>
          <button
            className="reset-btn"
            onClick={() => void handleExport("json")}
            title="Baixar relatório em JSON"
            aria-label="Exportar métricas em JSON"
          >
            <Download size={15} />
            JSON
          </button>
          <button
            className="reset-btn"
            onClick={load}
            title="Atualizar dados"
            aria-label="Atualizar dados"
          >
            <RefreshCw size={15} />
            Atualizar
          </button>
          <button
            className="reset-btn reset-btn--danger"
            onClick={() => setConfirmReset(true)}
            disabled={resetting}
            title="Redefinir todas as métricas"
          >
            <RotateCcw size={15} />
            Redefinir métricas
          </button>
        </div>
      </header>

      <div className="metrics-body">
        <div className="metrics-chart-card">
          <h2 className="metrics-panel-title">Status dos downloads</h2>
          <Donut
            segments={segments}
            centerLabel="baixado"
            centerValue={formatBytes(completedBytes)}
          />
          <ul className="donut-legend">
            {segments.map((segment) => {
              const pct =
                statusTotal > 0
                  ? Math.round((segment.value / statusTotal) * 100)
                  : 0;
              return (
                <li key={segment.label}>
                  <span className="legend-dot" style={{ background: segment.color }} />
                  {segment.label}
                  <b>{formatBytes(segment.value)}</b>
                  <span className="legend-pct">{pct}%</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="metrics-stats">
          <div className="metric-card metric-card--hero">
            <span className="metric-label">Total baixado</span>
            <strong className="metric-value metric-value--hero">
              {formatBytes(metrics?.totalBytes ?? 0)}
            </strong>
            <span className="metric-sub">
              {completedCount > 0 ? `${completedCount} download${completedCount > 1 ? "s" : ""} concluído${completedCount > 1 ? "s" : ""}` : "Nenhum download ainda"}
            </span>
          </div>

          <div className="metrics-grid">
            {cards.map((card) => (
              <div
                className={`metric-card metric-card--${card.accent}`}
                key={card.label}
              >
                <span className="metric-label">{card.label}</span>
                <strong className="metric-value">{card.value}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      {!metrics && (
        <p className="metrics-empty">
          <BarChart3 size={16} /> Nenhuma métrica registrada ainda.
        </p>
      )}

      {confirmReset && (
        <div className="cancel-overlay">
          <section className="cancel-dialog">
            <header>
              <span>Redefinir métricas?</span>
              <button onClick={() => setConfirmReset(false)} aria-label="Fechar">
                <X size={16} />
              </button>
            </header>
            <div>
              <i>
                <AlertTriangle size={16} />
              </i>
              <p>
                <strong>Deseja realmente redefinir todas as métricas?</strong>
                <span>
                  Isso apaga permanentemente os totais acumulados de downloads.
                  Exporte um backup em JSON antes se quiser preservá-los.
                </span>
              </p>
            </div>
            <footer>
              <button disabled={resetting} onClick={() => setConfirmReset(false)}>
                Cancelar
              </button>
              <button
                className="delete"
                disabled={resetting}
                onClick={() => void handleConfirmReset()}
              >
                <RotateCcw size={15} />
                Redefinir
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
