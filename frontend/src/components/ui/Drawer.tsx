import { useEffect } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useI18n } from "../../i18n";

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "max-w-[560px]",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <button
        type="button"
        aria-label={t("common.closeEvidencePanel")}
        onClick={onClose}
        className="absolute inset-0 bg-navy-950/25 animate-in"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : t("common.detailPanel")}
        className={[
          "relative flex h-full w-full flex-col border-l border-line bg-card shadow-overlay animate-slide-in",
          width,
        ].join(" ")}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <div className="text-base font-semibold text-ink-strong">{title}</div>
            {subtitle ? <div className="mt-0.5 text-xs text-ink-muted">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.closePanel")}
            className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-hover hover:text-ink-strong"
          >
            <X size={16} aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <footer className="border-t border-line bg-subtle px-5 py-3">{footer}</footer> : null}
      </aside>
    </div>
  );
}
