import { X } from "lucide-react";
import { useToasts } from "../store/toast";

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <i className="dot" />
          <span>{t.text}</span>
          <button className="icon-btn xs flat" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <X />
          </button>
        </div>
      ))}
    </div>
  );
}
