import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { useI18n } from "../../i18n";

type ToastTone = "success" | "warning" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
}

interface ToastApi {
  push: (toast: Omit<ToastItem, "id">) => void;
}

const ToastContext = createContext<ToastApi>({ push: () => undefined });

const ICONS = {
  success: CheckCircle2,
  warning: AlertTriangle,
  info: Info,
};

const TONE_CLASSES: Record<ToastTone, string> = {
  success: "border-pass-line bg-white text-ink-strong",
  warning: "border-warn-line bg-white text-ink-strong",
  info: "border-info-line bg-white text-ink-strong",
};

const ICON_CLASSES: Record<ToastTone, string> = {
  success: "text-pass",
  warning: "text-warn",
  info: "text-info",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const { t } = useI18n();

  const push = useCallback((toast: Omit<ToastItem, "id">) => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setItems((current) => current.filter((item) => item.id !== id));
    }, 4500);
  }, []);

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-5 right-5 z-[80] flex w-[360px] max-w-[calc(100vw-2.5rem)] flex-col gap-2"
      >
        {items.map((item) => {
          const Icon = ICONS[item.tone];
          return (
            <div
              key={item.id}
              className={[
                "pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3.5 py-3 shadow-raised animate-rise",
                TONE_CLASSES[item.tone],
              ].join(" ")}
            >
              <Icon size={16} className={["mt-0.5 shrink-0", ICON_CLASSES[item.tone]].join(" ")} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{item.title}</div>
                {item.detail ? <div className="mt-0.5 text-xs text-ink-muted">{item.detail}</div> : null}
              </div>
              <button
                type="button"
                aria-label={t("toast.dismiss")}
                onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
                className="rounded p-1 text-ink-faint hover:bg-hover hover:text-ink"
              >
                <X size={12} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = (): ToastApi => useContext(ToastContext);
