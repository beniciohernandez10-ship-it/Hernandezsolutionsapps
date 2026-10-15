import * as React from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions, children }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-fg">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      {icon ? <div className="mb-1 text-subtle [&_svg]:size-8">{icon}</div> : null}
      <p className="text-sm font-medium text-fg">{title}</p>
      {children ? <div className="max-w-md text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Progress({ value, max = 100, className }: { value: number; max?: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-3", className)} role="progressbar" aria-valuenow={value} aria-valuemax={max} aria-valuemin={0}>
      <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "danger" | "warning" | "success" }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <span className={cn("text-2xl font-semibold tabular-nums tracking-tight", tone === "danger" && "text-danger", tone === "warning" && "text-warning", tone === "success" && "text-success")}>{value}</span>
      {hint ? <span className="text-xs text-subtle">{hint}</span> : null}
    </div>
  );
}

export function Alert({ tone = "neutral", title, children, className }: { tone?: "neutral" | "warning" | "danger" | "success" | "accent"; title?: string; children?: React.ReactNode; className?: string }) {
  const tones = {
    neutral: "border-border bg-surface-2",
    warning: "border-warning/30 bg-warning-soft",
    danger: "border-danger/30 bg-danger-soft",
    success: "border-success/30 bg-success-soft",
    accent: "border-accent/30 bg-accent-soft",
  };
  return (
    <div className={cn("rounded-md border px-3 py-2 text-sm", tones[tone], className)} role={tone === "danger" ? "alert" : undefined}>
      {title ? <p className="font-medium">{title}</p> : null}
      {children ? <div className={cn("text-fg/80", title && "mt-0.5")}>{children}</div> : null}
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(110px,40%)_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-fg">{children ?? "—"}</dd>
    </div>
  );
}
