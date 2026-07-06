import {
  Activity,
  Ban,
  CalendarDays,
  CheckCircle2,
  Database,
  Download,
  Gauge,
  HardDrive,
  TriangleAlert,
  RefreshCw,
  Tags,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ProfileStatistics } from "../domain/profile";
import * as downloadService from "../services/downloadService";

const bytes = (value: number) => {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let current = Math.max(0, value);
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index++;
  }
  return `${current.toFixed(index > 2 ? 2 : index ? 1 : 0)} ${units[index]}`;
};

const formatDay = (value: string | null) =>
  value
    ? new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : "Sem dados ainda";

export function ProfilePage() {
  const [stats, setStats] = useState<ProfileStatistics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await downloadService.profileStatistics());
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  const largestCategory = stats?.categories[0]?.bytes ?? 0;
  return (
    <section className="profile-dashboard">
      <header className="profile-heading">
        <div>
          <span>ESTATÍSTICAS LOCAIS</span>
          <h1>Meu Perfil</h1>
          <p>Um retrato do que passou pelo SF Downloader neste dispositivo.</p>
        </div>
        <button onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={loading ? "spinning" : ""} />
          Atualizar
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}
      {!stats ? (
        <div className="profile-loading">Calculando suas estatísticas...</div>
      ) : (
        <>
          <div className="profile-summary-grid">
            <article className="profile-primary-card">
              <i><Download /></i>
              <span>Total geral</span>
              <strong>{bytes(stats.totalDownloaded)}</strong>
              <small>Concluídos + falhados + cancelados</small>
            </article>
            <article className="profile-completed-card">
              <i><CheckCircle2 /></i>
              <span>Downloads concluídos</span>
              <strong>{bytes(stats.completedBytes)}</strong>
              <small>{stats.completedDownloads} arquivos finalizados</small>
            </article>
            <article className="profile-failed-card">
              <i><TriangleAlert /></i>
              <span>Downloads falhados</span>
              <strong>{bytes(stats.failedBytes)}</strong>
              <small>Maior progresso preservado por arquivo</small>
            </article>
            <article className="profile-cancelled-card">
              <i><Ban /></i>
              <span>Downloads cancelados</span>
              <strong>{bytes(stats.cancelledBytes)}</strong>
              <small>Conta mesmo quando o parcial foi apagado</small>
            </article>
            <article>
              <i><HardDrive /></i>
              <span>Gravado no SSD</span>
              <strong>{bytes(stats.minimumDiskWritten)}</strong>
              <small>Mínimo confirmado pelos arquivos finais</small>
            </article>
            <article>
              <i><Database /></i>
              <span>Lido do SSD</span>
              <strong>{stats.diskReadAvailable ? bytes(stats.diskRead) : "Em coleta"}</strong>
              <small>{stats.diskReadAvailable ? "Leitura causada por extrações medidas" : "Será medido nas próximas operações"}</small>
            </article>
            <article>
              <i><Gauge /></i>
              <span>Velocidade média</span>
              <strong>{bytes(stats.averageSpeed)}/s</strong>
              <small>Média dos downloads concluídos</small>
            </article>
          </div>

          <div className="profile-detail-grid">
            <section className="profile-panel profile-categories">
              <header><Tags /><div><h2>Tipos de arquivo</h2><p>Volume concluído por categoria</p></div></header>
              {stats.categories.length === 0 ? (
                <div className="profile-empty">Conclua um download para começar.</div>
              ) : stats.categories.map(category => (
                <article key={category.name}>
                  <div><strong>{category.name}</strong><span>{category.files} arquivos · {bytes(category.bytes)}</span></div>
                  <div className="profile-category-track"><i style={{ width: `${largestCategory ? Math.max(4, category.bytes / largestCategory * 100) : 0}%` }} /></div>
                </article>
              ))}
            </section>

            <section className="profile-panel profile-highlights">
              <header><Activity /><div><h2>Resumo</h2><p>Atividade registrada neste dispositivo</p></div></header>
              <article><CalendarDays /><div><span>Seu dia mais intenso</span><strong>{formatDay(stats.bestDay)}</strong><small>{bytes(stats.bestDayBytes)} baixados</small></div></article>
              <article><CheckCircle2 /><div><span>Concluídos</span><strong>{stats.completedDownloads}</strong><small>{stats.activeDownloads} ativos agora</small></div></article>
              <article><Activity /><div><span>Falhas e cancelamentos</span><strong>{stats.failedDownloads}</strong><small>Itens ainda presentes na lista</small></div></article>
            </section>
          </div>
        </>
      )}
    </section>
  );
}
