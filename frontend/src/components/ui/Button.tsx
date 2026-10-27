import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-navy-800 text-white border border-navy-800 hover:bg-navy-700 hover:border-navy-700 shadow-[0_1px_2px_rgba(15,42,74,0.24)]",
  secondary:
    "bg-white text-ink-strong border border-line-strong hover:bg-hover hover:border-ink-faint",
  ghost: "bg-transparent text-ink border border-transparent hover:bg-hover",
  danger:
    "bg-stop text-white border border-stop hover:bg-[#9a1d14] hover:border-[#9a1d14]",
  success:
    "bg-pass text-white border border-pass hover:bg-[#0b6450] hover:border-[#0b6450]",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "h-10 px-4 text-base gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, className = "", children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={[
        "inline-flex items-center justify-center rounded-md font-medium transition-colors duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600",
        "disabled:cursor-not-allowed disabled:opacity-45",
        VARIANTS[variant],
        SIZES[size],
        className,
      ].join(" ")}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});
