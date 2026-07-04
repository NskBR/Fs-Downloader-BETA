import type { LucideIcon } from "lucide-react";
import { Calculator, Clock3, Download, FolderTree, Home, Send, Settings, Users } from "lucide-react";
export type PageId = "home" | "downloads" | "active" | "completed" | "documents" | "music" | "videos" | "archives" | "applications" | "transfer" | "history" | "organization" | "profile" | "calculator" | "settings";
export interface NavigationItem { id: PageId; label: string; description: string; icon: LucideIcon; }
export const navigationItems: NavigationItem[] = [
  { id: "home", label: "Home", description: "Visão geral da sua atividade", icon: Home },
  { id: "downloads", label: "Downloads", description: "Gerencie arquivos e progresso", icon: Download },
  { id: "transfer", label: "Enviar/Receber", description: "Transferências diretas entre dispositivos", icon: Send },
  { id: "history", label: "Histórico", description: "Consulte atividades anteriores", icon: Clock3 },
  { id: "organization", label: "Organização", description: "Categorias e destino dos arquivos", icon: FolderTree },
  { id: "profile", label: "Amigos/Perfil", description: "Seu perfil e conexões", icon: Users },
  { id: "calculator", label: "Calculadora", description: "Estime o tempo de download", icon: Calculator },
  { id: "settings", label: "Configurações", description: "Preferências do aplicativo", icon: Settings }
  ,{ id: "active", label: "Ativos", description: "Downloads em andamento", icon: Download }
  ,{ id: "completed", label: "Concluídos", description: "Downloads concluídos", icon: Download }
  ,{ id: "documents", label: "Documentos", description: "Arquivos de documentos", icon: FolderTree }
  ,{ id: "music", label: "Músicas", description: "Arquivos de áudio", icon: FolderTree }
  ,{ id: "videos", label: "Vídeos", description: "Arquivos de vídeo", icon: FolderTree }
  ,{ id: "archives", label: "Compactados", description: "Arquivos compactados", icon: FolderTree }
  ,{ id: "applications", label: "Aplicativos", description: "Instaladores e programas", icon: FolderTree }
];
export const isPageId = (value: string): value is PageId => navigationItems.some((item) => item.id === value);
