import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/** Collapsed technical details. Native `<details>` keeps keyboard support. */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className = "",
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details
      open={defaultOpen}
      className={["group rounded-md border border-line bg-subtle", className].join(" ")}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-ink transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          size={14}
          className="shrink-0 text-ink-faint transition-transform group-open:rotate-90"
          aria-hidden
        />
        <span className="min-w-0 flex-1">{summary}</span>
      </summary>
      <div className="border-t border-line px-3 py-2.5 text-xs leading-5 text-ink">{children}</div>
    </details>
  );
}
