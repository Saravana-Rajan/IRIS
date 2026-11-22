import { X } from "lucide-react";
import { useEffect, useRef } from "react";

/** A sheet from the right, opened from the app shell's sidebar: Settings (every action the old menu held, by name, in the
 * order of the work: models, coordinate, this session's outputs, the panels) and Help. Escape or the scrim closes it. */
export function MenuSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    window.addEventListener("keydown", esc);
    panel.current?.querySelector<HTMLElement>(".menu-head .ibtn")?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", esc);
  }, []);
  return (
    <div className="menu-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="menu-panel" ref={panel} onClick={(e) => e.stopPropagation()}>
        <div className="menu-head">
          <h2 className="menu-title">{title}</h2>
          <button type="button" className="ibtn" aria-label={`Close ${title}`} onClick={onClose}><X size={20} aria-hidden /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
