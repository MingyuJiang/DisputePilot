import type { ReactNode } from "react";
import type { Tone } from "../../lib/statusModel";

const BARS: Record<Tone, string> = {
  neutral: "bg-line-strong",
  info: "bg-info",
  pass: "bg-pass",
  warn: "bg-warn",
  stop: "bg-stop",
};

/**
 * One section = one title, one optional description, one action area.
 * Sections are not nested cards: the body is plain content.
 */
export function PageSection({
  title,
  description,
  actions,
  tone = "neutral",
  children,
  className = "",
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={["rounded-lg border border-line bg-card shadow-card", className].join(" ")}
    >
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold leading-6 text-ink-strong">
            <span className={["h-3.5 w-[3px] shrink-0 rounded", BARS[tone]].join(" ")} aria-hidden />
            <span className="min-w-0">{title}</span>
          </h2>
          {description ? (
            <p className="mt-1 text-xs leading-5 text-ink-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  );
}
