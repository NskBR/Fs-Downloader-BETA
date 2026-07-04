import { Construction } from "lucide-react";
import type { NavigationItem } from "../app/navigation";
export function EmptyPage({ item: { label, description, icon: Icon } }: { item: NavigationItem }) {
  return <section className="page"><header className="page__header"><div><span className="eyebrow">SF Downloader</span><h1>{label}</h1><p>{description}</p></div><div className="page__icon"><Icon size={24}/></div></header><div className="empty-state"><div className="empty-state__icon"><Construction size={25}/></div><h2>Área preparada</h2><p>Esta tela faz parte da base do aplicativo e receberá suas funcionalidades nas próximas fases.</p><span className="phase-badge">FASE 0 · Estrutura inicial</span></div></section>;
}
