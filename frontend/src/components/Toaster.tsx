import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

type ToastType = "success" | "error" | "info";
type Toast = { id: number; message: string; type: ToastType };

let counter = 0;

/**
 * Fire a non-blocking toast from anywhere (no provider/hook needed):
 *   toast("Inward posted");  toast("Something failed", "error")
 */
export function toast(message: string, type: ToastType = "success") {
  if (!message) return;
  document.dispatchEvent(new CustomEvent("mm-toast", { detail: { message, type } }));
}

/** Mount once (in App). Listens for toast() calls and renders the stack. */
export default function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    function onToast(e: Event) {
      const d = (e as CustomEvent).detail as { message: string; type: ToastType };
      const id = ++counter;
      setToasts((t) => [...t, { id, message: d.message, type: d.type }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
    }
    document.addEventListener("mm-toast", onToast);
    return () => document.removeEventListener("mm-toast", onToast);
  }, []);

  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));

  return (
    <div className="mm-toaster" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => {
        const Icon = t.type === "error" ? AlertCircle : t.type === "info" ? Info : CheckCircle2;
        return (
          <div key={t.id} className={`mm-toast mm-toast-${t.type}`} role="status">
            <Icon size={17} className="mm-toast-ico" />
            <span className="mm-toast-msg">{t.message}</span>
            <button type="button" className="mm-toast-x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
