import { useState, useRef, useEffect } from "react";
import { Sparkles, Bot, X, Send, Wand2, Zap, MessageSquare } from "lucide-react";

export function FloatingAiWidget() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ x: window.innerWidth - 80, y: window.innerHeight - 80 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; posX: number; posY: number }>({
    startX: 0,
    startY: 0,
    posX: 0,
    posY: 0,
  });
  const hasMovedRef = useRef(false);

  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => ({
        x: Math.min(prev.x, window.innerWidth - 70),
        y: Math.min(prev.y, window.innerHeight - 70),
      }));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    setIsDragging(true);
    hasMovedRef.current = false;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: position.x,
      posY: position.y,
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasMovedRef.current = true;
      }
      const newX = Math.max(20, Math.min(window.innerWidth - 70, dragRef.current.posX + dx));
      const newY = Math.max(60, Math.min(window.innerHeight - 70, dragRef.current.posY + dy));
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  const handleClick = () => {
    if (!hasMovedRef.current) {
      setOpen((prev) => !prev);
    }
  };

  return (
    <div
      className="ai-widget-root"
      style={{
        position: "fixed",
        left: `${position.x}px`,
        top: `${position.y}px`,
        zIndex: 9999,
      }}
    >
      {/* Draggable Bubble */}
      <button
        type="button"
        className={`ai-widget-bubble ${isDragging ? "is-dragging" : ""}`}
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        title="Assistente de IA SF Downloader (Arraste para mover)"
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
