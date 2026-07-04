import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
const appWindow = getCurrentWindow();
export function TitleBar() { return <header className="titlebar" data-tauri-drag-region onDoubleClick={() => void appWindow.toggleMaximize()}><div className="window-controls"><button aria-label="Minimizar" onClick={() => void appWindow.minimize()}><Minus size={17}/></button><button aria-label="Maximizar" onClick={() => void appWindow.toggleMaximize()}><Square size={14}/></button><button className="window-close" aria-label="Fechar" onClick={() => void appWindow.close()}><X size={18}/></button></div></header>; }
