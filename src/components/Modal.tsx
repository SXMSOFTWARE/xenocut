import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  dismissable?: boolean;
}

export function Modal({ title, subtitle, onClose, children, footer, width, dismissable = true }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissable) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, dismissable]);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && dismissable && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={width ? { width: `min(${width}px, calc(100vw - 48px))` } : undefined}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {dismissable && (
            <button className="icon-btn sm" onClick={onClose} aria-label="Close">
              <X />
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
