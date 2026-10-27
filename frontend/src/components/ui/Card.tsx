import type { HTMLAttributes, ReactNode } from "react";

export function Card({ className = "", children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={["rounded-lg border border-line bg-card shadow-card", className].join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
  className = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={["flex items-start justify-between gap-3 border-b border-line px-4 py-3", className].join(" ")}>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-ink-strong">{title}</div>
        {subtitle ? <div className="mt-0.5 text-xs text-ink-muted">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={["px-4 py-3", className].join(" ")}>{children}</div>;
}

export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={["eyebrow", className].join(" ")}>{children}</div>;
}

export function Divider({ className = "" }: { className?: string }) {
  return <div className={["h-px w-full bg-line", className].join(" ")} />;
}
