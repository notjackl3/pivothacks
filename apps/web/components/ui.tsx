"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import type { ChipTone } from "@/lib/status";
import { describeError } from "@/lib/api";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// ───────────────────────────── Chip ─────────────────────────────

const CHIP_TONE: Record<ChipTone, string> = {
  neutral: "bg-quiet-soft text-quiet",
  accent: "bg-accent-soft text-accent-strong",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

const CHIP_SIZE = {
  sm: "px-2.5 py-0.5 text-[11px] tracking-[0.08em] gap-1.5",
  md: "px-3 py-1 text-[13px] tracking-[0.06em] gap-2",
  lg: "px-3.5 py-1.5 text-[15px] tracking-[0.05em] gap-2",
  xl: "px-4 py-2 text-[18px] tracking-[0.05em] gap-2.5",
} as const;

const DOT_SIZE = { sm: "h-1.5 w-1.5", md: "h-2 w-2", lg: "h-2.5 w-2.5", xl: "h-3 w-3" } as const;

export interface ChipProps {
  tone?: ChipTone;
  size?: keyof typeof CHIP_SIZE;
  /** Pulses the dot: the state is still moving. */
  active?: boolean;
  dot?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}

export function Chip({ tone = "neutral", size = "sm", active = false, dot = true, title, className, children }: ChipProps) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center rounded-full font-semibold uppercase whitespace-nowrap leading-none",
        CHIP_TONE[tone],
        CHIP_SIZE[size],
        className,
      )}
    >
      {dot && <span aria-hidden className={cx("shrink-0 rounded-full bg-current", DOT_SIZE[size], active && "rr-pulse")} />}
      {children}
    </span>
  );
}

export function MockBadge({ size = "sm", className }: { size?: "sm" | "md"; className?: string }) {
  return (
    <span
      title="Injected from a saved Slack payload for the demo"
      className={cx(
        "inline-flex items-center rounded-md border border-warning/40 bg-warning-soft font-mono font-medium uppercase text-warning",
        size === "sm" ? "px-1.5 py-0.5 text-[10px] tracking-[0.12em]" : "px-2 py-1 text-xs tracking-[0.12em]",
        className,
      )}
    >
      Mock
    </span>
  );
}

// ───────────────────────────── Button ─────────────────────────────

const BUTTON_VARIANT = {
  primary:
    "bg-accent text-white hover:bg-accent-strong active:bg-accent-strong shadow-[inset_0_-1px_0_rgba(0,0,0,0.12)] disabled:bg-accent/50",
  secondary:
    "bg-surface text-ink border border-line-strong hover:border-ink-faint hover:bg-surface-muted disabled:text-ink-faint",
  ghost: "bg-transparent text-accent-strong hover:bg-accent-soft disabled:text-ink-faint",
  danger: "bg-surface text-danger border border-danger/40 hover:bg-danger-soft disabled:text-ink-faint",
} as const;

const BUTTON_SIZE = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-base",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof BUTTON_VARIANT;
  size?: keyof typeof BUTTON_SIZE;
  loading?: boolean;
}

export function Button({ variant = "primary", size = "md", loading = false, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed",
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = "secondary",
  size = "md",
  className,
  children,
  external = false,
}: {
  href: string;
  variant?: keyof typeof BUTTON_VARIANT;
  size?: keyof typeof BUTTON_SIZE;
  className?: string;
  children: ReactNode;
  external?: boolean;
}) {
  const cls = cx(
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors",
    BUTTON_VARIANT[variant],
    BUTTON_SIZE[size],
    className,
  );
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

// ───────────────────────────── Card ─────────────────────────────

export interface CardProps {
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
  /** Stagger index for the entrance animation. */
  index?: number;
}

export function Card({ eyebrow, title, description, action, className, bodyClassName, children, index = 0 }: CardProps) {
  return (
    <section
      className={cx("rr-rise rounded-2xl border border-line bg-surface shadow-card", className)}
      style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
    >
      {(eyebrow || title || description || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
          <div className="min-w-0">
            {eyebrow && <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">{eyebrow}</p>}
            {title && <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>}
            {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cx("px-5 py-5 sm:px-6", bodyClassName)}>{children}</div>
    </section>
  );
}

// ───────────────────────────── Banner ─────────────────────────────

const BANNER_TONE: Record<ChipTone, string> = {
  neutral: "border-line bg-surface-muted text-ink",
  accent: "border-accent/30 bg-accent-soft text-accent-strong",
  success: "border-success/30 bg-success-soft text-success",
  warning: "border-warning/30 bg-warning-soft text-warning",
  danger: "border-danger/30 bg-danger-soft text-danger",
};

export function Banner({
  tone = "neutral",
  title,
  children,
  onDismiss,
  className,
}: {
  tone?: ChipTone;
  title?: ReactNode;
  children?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", BANNER_TONE[tone], className)}>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx(title ? "mt-0.5" : undefined, "break-words")}>{children}</div>}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-mr-1 rounded-md px-1.5 text-lg leading-none opacity-70 hover:opacity-100">
          ×
        </button>
      )}
    </div>
  );
}

export function ErrorBanner({ error, onDismiss, className }: { error: unknown; onDismiss?: () => void; className?: string }) {
  if (!error) return null;
  return (
    <Banner tone="danger" onDismiss={onDismiss} className={className}>
      {describeError(error)}
    </Banner>
  );
}

// ───────────────────────────── Form controls ─────────────────────────────

export function Label({ htmlFor, children, hint }: { htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
      {children}
      {hint && <span className="ml-2 text-xs font-normal text-ink-faint">{hint}</span>}
    </label>
  );
}

const CONTROL_CLS =
  "block w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring/60 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-faint";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(CONTROL_CLS, "h-10", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(CONTROL_CLS, "h-10 pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

// ───────────────────────────── Misc ─────────────────────────────

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("rr-spin", className ?? "h-5 w-5")} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function FullPageSpinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-32 text-ink-muted">
      <Spinner className="h-6 w-6 text-accent" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface-muted px-6 py-14 text-center">
      <p className="text-base font-semibold text-ink">{title}</p>
      {children && <p className="mt-2 max-w-md text-sm text-ink-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function KeyValue({ label, children, mono = false }: { label: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">{label}</dt>
      <dd className={cx("mt-0.5 break-words text-sm text-ink", mono && "font-mono tabular-nums")}>{children}</dd>
    </div>
  );
}

export function AiLabel({ children = "AI-assisted", className }: { children?: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-faint", className)}>
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-sm bg-accent" />
      {children}
    </span>
  );
}
