import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { Tone } from "@/lib/status";

/* Small, dependency-free UI kit. Hierarchy comes from spacing and type,
   not from wrapping everything in identical cards. */

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 py-2.5 text-sm font-semibold " +
  "transition-colors disabled:cursor-not-allowed disabled:opacity-50 min-h-11";

const BUTTON_VARIANT: Record<Variant, string> = {
  primary: "bg-cobalt text-white hover:bg-cobalt-dark",
  secondary: "bg-surface text-ink ring-1 ring-line hover:ring-ink/40",
  ghost: "text-cobalt hover:bg-cobalt-soft",
  danger: "bg-surface text-danger ring-1 ring-danger/40 hover:bg-danger-soft",
};

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], className)} {...props} />;
}

export function ButtonLink({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], className)} {...props} />;
}

const CONTROL =
  "w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2.5 text-base text-ink " +
  "placeholder:text-muted/70 focus:border-cobalt focus:outline-none focus:ring-2 focus:ring-cobalt/25 " +
  "aria-[invalid=true]:border-danger";

export function Field({
  label, name, error, hint, children,
}: { label: string; name: string; error?: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="block text-sm font-medium">{label}</label>
      {children}
      {hint && !error && <p className="text-sm text-muted">{hint}</p>}
      {error && <p id={`${name}-error`} className="text-sm text-danger">{error}</p>}
    </div>
  );
}

export function Input({ error, ...props }: ComponentProps<"input"> & { error?: string }) {
  return (
    <input
      id={props.name}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${props.name}-error` : undefined}
      className={CONTROL}
      {...props}
    />
  );
}

export function Textarea({ error, ...props }: ComponentProps<"textarea"> & { error?: string }) {
  return <textarea id={props.name} aria-invalid={error ? true : undefined} className={cx(CONTROL, "min-h-24")} {...props} />;
}

export function Select({ error, ...props }: ComponentProps<"select"> & { error?: string }) {
  return <select id={props.name} aria-invalid={error ? true : undefined} className={CONTROL} {...props} />;
}

const TONE: Record<Tone, string> = {
  neutral: "bg-line/60 text-ink",
  info: "bg-cobalt-soft text-cobalt-dark",
  success: "bg-mint-soft text-mint",
  warning: "bg-sun-soft text-sun",
  danger: "bg-danger-soft text-danger",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", TONE[tone])}>
      {children}
    </span>
  );
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("rounded-[var(--radius-panel)] bg-surface p-5 ring-1 ring-line sm:p-6", className)}>{children}</section>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-dashed border-line px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Alert({ tone = "danger", children }: { tone?: Tone; children: ReactNode }) {
  return <div role="status" className={cx("rounded-[var(--radius-control)] px-4 py-3 text-sm", TONE[tone])}>{children}</div>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-[var(--radius-control)] bg-line/60", className)} />;
}
