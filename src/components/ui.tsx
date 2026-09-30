import clsx, { type ClassValue } from "clsx";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export const cn = (...v: ClassValue[]) => clsx(v);

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-10 px-4 text-sm",
        variant === "primary" && "bg-accent text-accent-fg hover:opacity-90",
        variant === "secondary" && "border border-border bg-panel text-text hover:bg-panel-2",
        variant === "ghost" && "text-muted hover:bg-panel-2 hover:text-text",
        variant === "danger" && "text-high hover:bg-high-soft",
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export type Tone = "high" | "medium" | "low" | "ok" | "neutral" | "accent";

const TONES: Record<Tone, string> = {
  high: "bg-high-soft text-high",
  medium: "bg-medium-soft text-medium",
  low: "bg-low-soft text-low",
  ok: "bg-ok-soft text-ok",
  neutral: "bg-panel-2 text-muted",
  accent: "bg-accent-soft text-accent",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11.5px] font-medium", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function severityTone(s: string): Tone {
  if (s === "high") return "high";
  if (s === "medium" || s === "warn") return "medium";
  if (s === "low") return "low";
  if (s === "none" || s === "consistent") return "ok";
  if (s === "contradicted") return "high";
  return "neutral";
}

export function Dots() {
  return (
    <span className="dot-pulse inline-flex gap-0.5" aria-hidden>
      <span className="size-1.5 rounded-full bg-current" />
      <span className="size-1.5 rounded-full bg-current" />
      <span className="size-1.5 rounded-full bg-current" />
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="8" className="fill-accent" />
      <circle cx="14.5" cy="14.5" r="6.5" fill="none" strokeWidth="2.6" className="stroke-accent-fg" />
      <path d="M19.5 19.5 25 25" strokeWidth="2.8" strokeLinecap="round" className="stroke-accent-fg" />
      <path d="M11.5 14.5h6M14.5 11.5v6" strokeWidth="1.8" strokeLinecap="round" className="stroke-accent-fg" opacity=".85" />
    </svg>
  );
}
