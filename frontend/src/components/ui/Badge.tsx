import type { ReactNode } from "react";

export type BadgeTone =
  | "neutral"
  | "navy"
  | "pass"
  | "warn"
  | "stop"
  | "info"
  | "infer"
  | "scenario";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-sunken text-ink-muted border-line",
  navy: "bg-navy-50 text-navy-700 border-navy-100",
  pass: "bg-pass-bg text-pass border-pass-line",
  warn: "bg-warn-bg text-warn border-warn-line",
  stop: "bg-stop-bg text-stop border-stop-line",
  info: "bg-info-bg text-info border-info-line",
  infer: "bg-infer-bg text-infer border-infer-line",
  scenario: "bg-scenario-bg text-scenario border-scenario-line",
};

const SIZES: Record<"sm" | "md", string> = {
  sm: "text-2xs",
  /** Metadata floor: 12 px so status text stays readable at 1280 and on video. */
  md: "text-xs",
};

export interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
  uppercase?: boolean;
  size?: "sm" | "md";
}

export function Badge({
  tone = "neutral",
  children,
  dot = false,
  className = "",
  uppercase = false,
  size = "sm",
}: BadgeProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 font-medium leading-4 whitespace-nowrap",
        SIZES[size],
        uppercase ? "uppercase tracking-[0.06em]" : "",
        TONES[tone],
        className,
      ].join(" ")}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden /> : null}
      {children}
    </span>
  );
}
