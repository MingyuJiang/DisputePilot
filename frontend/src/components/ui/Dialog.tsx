import { useEffect } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useI18n } from "../../i18n";

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "max-w-[520px]",
  tone = "default",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
  width?: string;
  tone?: "default" | "danger";
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
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-6 sm:items-center">
      <button
        type="button"
        aria-label={t("common.closeDialog")}
        onClick={onClose}
        className="fixed inset-0 bg-navy-950/30 animate-in"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : t("common.dialog")}
        className={["relative w-full rounded-xl border border-line bg-card shadow-overlay animate-rise", width].join(" ")}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className={["text-md font-semibold", tone === "danger" ? "text-stop" : "text-ink-strong"].join(" ")}>
              {title}
            </h2>
            {description ? <p className="mt-1 text-xs text-ink-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.closeDialog")}
            className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-hover hover:text-ink-strong"
          >
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-line bg-subtle px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}
