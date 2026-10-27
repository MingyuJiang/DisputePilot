import type { ReactNode } from "react";
import { CircleDashed } from "lucide-react";

/** No data is a first-class state: it never looks like a failure. */
export function EmptyState({
  title,
  body,
  action,
  compact = false,
}: {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={[
        "flex flex-col items-center justify-center gap-1.5 text-center",
        compact ? "px-2 py-6" : "px-4 py-12",
      ].join(" ")}
      data-testid="empty-state"
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-subtle">
        <CircleDashed size={14} className="text-ink-faint" aria-hidden />
      </div>
      <p className="text-base font-medium leading-6 text-ink-strong">{title}</p>
      {body ? <p className="max-w-sm text-xs leading-5 text-ink-muted">{body}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
