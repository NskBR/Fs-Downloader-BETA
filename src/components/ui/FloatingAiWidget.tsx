import { useState, useRef, useEffect } from "react";
import { Sparkles, Bot, X, Send, Wand2, Zap, MessageSquare } from "lucide-react";

export function FloatingAiWidget() {
  const [open, setOpen] = useState(false);
  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (widgetRef.current && !widgetRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={widgetRef} className="ai-widget-root">
      {/* Fixed Bubble Button */}
      <button
        type="button"
        className="ai-widget-bubble"
        onClick={() => setOpen((prev) => !prev)}
        title="Assistente de IA SF Downloader (Preview)"
      >
        <div className="ai-widget-glow" />
        <div className="ai-widget-icon">
          <Sparkles size={22} />
        </div>
      </button>

      {/* Floating Popover Preview */}
      {open && (
        <div className="ai-widget-popover">
          <div className="ai-popover-header">
            <div className="ai-popover-brand">
              <div className="ai-popover-badge-icon">
                <Bot size={18} />
              </div>
              <div>
                <span className="ai-popover-title">SF AI Assistant</span>
                <span className="ai-popover-tag">Em desenvolvimento</span>
              </div>
            </div>
            <button className="ai-popover-close" onClick={() => setOpen(false)} title="Fechar">
              <X size={15} />
            </button>
          </div>

          <div className="ai-popover-body">
            <div className="ai-popover-msg">
              <Sparkles size={16} className="ai-sparkle-gold" />
              <p>
                Em breve você poderá conversar com a Inteligência Artificial para otimizar rotas, analisar vírus, resumir downloads e organizar seus arquivos automaticamente!
              </p>
            </div>

            <div className="ai-popover-chips">
              <button type="button" className="ai-chip">
                <Wand2 size={12} />
                <span>Otimizar downloads</span>
              </button>
              <button type="button" className="ai-chip">
                <Zap size={12} />
                <span>Testar velocidade</span>
              </button>
              <button type="button" className="ai-chip">
                <MessageSquare size={12} />
                <span>Perguntar algo</span>
              </button>
            </div>

            <div className="ai-popover-input-wrap">
              <input
                type="text"
                className="ai-popover-input"
                placeholder="Pergunte à IA (Preview)..."
                disabled
              />
              <button className="ai-popover-send" disabled title="Enviar">
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
