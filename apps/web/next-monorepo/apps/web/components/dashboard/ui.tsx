"use client"

import React from "react"
import { cn } from "@workspace/ui/lib/utils"
import type { KioskStatus } from "@/lib/backend-api"
import { gsap, prefersReducedMotion, EASE } from "@/lib/gsap"

/** Subtle one-shot entrance (fade + rise). Reduced-motion safe. No loops. */
function useEntrance<T extends HTMLElement>() {
  const ref = React.useRef<T>(null)
  React.useEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion()) return
    const ctx = gsap.context(() => {
      gsap.fromTo(
        el.children,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.4, ease: EASE, stagger: 0.06 }
      )
    }, el)
    return () => ctx.revert()
  }, [])
  return ref
}

/** Shimmering placeholder block. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted/60", className)} />
}

/** A titled panel used for dashboard sections. */
export function Panel({
  title,
  subtitle,
  action,
  className,
  children,
}: {
  title?: React.ReactNode
  subtitle?: React.ReactNode
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card p-5 shadow-sm",
        className
      )}
    >
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold tracking-tight">{title}</h2>}
            {subtitle && (
              <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function ErrorState({
  message = "Something went wrong.",
  onRetry,
  className,
}: {
  message?: string
  onRetry?: () => void
  className?: string
}) {
  const ref = useEntrance<HTMLDivElement>()
  return (
    <div
      ref={ref}
      className={cn(
        "flex flex-col items-center justify-center gap-2 py-8 text-center",
        className
      )}
    >
      <p className="text-sm text-destructive">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  )
}

export function EmptyState({
  message,
  icon,
  className,
}: {
  message: string
  icon?: React.ReactNode
  className?: string
}) {
  const ref = useEntrance<HTMLDivElement>()
  return (
    <div
      ref={ref}
      className={cn(
        "flex flex-col items-center justify-center gap-2 py-8 text-center text-muted-foreground",
        className
      )}
    >
      {icon && (
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted/50 text-muted-foreground/70">
          {icon}
        </div>
      )}
      <p className="text-sm">{message}</p>
    </div>
  )
}

/** Semantic dot + label + filled-pill styling per kiosk status. */
export const STATUS_META: Record<KioskStatus, { label: string; dot: string; text: string; pill: string; hex: string }> = {
  AVAILABLE: { label: "Available", dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400", pill: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", hex: "#10b981" },
  RESERVED: { label: "Reserved", dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400", pill: "bg-amber-500/10 text-amber-600 dark:text-amber-400", hex: "#f59e0b" },
  ASSIGNED: { label: "Assigned", dot: "bg-blue-500", text: "text-blue-600 dark:text-blue-400", pill: "bg-blue-500/10 text-blue-600 dark:text-blue-400", hex: "#3b82f6" },
  INSTALLED: { label: "Installed", dot: "bg-indigo-500", text: "text-indigo-600 dark:text-indigo-400", pill: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400", hex: "#6366f1" },
  MAINTENANCE: { label: "Maintenance", dot: "bg-rose-500", text: "text-rose-600 dark:text-rose-400", pill: "bg-rose-500/10 text-rose-600 dark:text-rose-400", hex: "#f43f5e" },
  RETURNED: { label: "Returned", dot: "bg-purple-500", text: "text-purple-600 dark:text-purple-400", pill: "bg-purple-500/10 text-purple-600 dark:text-purple-400", hex: "#a855f7" },
  RETIRED: { label: "Retired", dot: "bg-slate-500", text: "text-slate-600 dark:text-slate-400", pill: "bg-slate-500/10 text-slate-600 dark:text-slate-400", hex: "#64748b" },
}

export function StatusBadge({ status }: { status: KioskStatus }) {
  const meta = STATUS_META[status] ?? {
    label: status,
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
    pill: "bg-muted text-muted-foreground",
  }
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium", meta.pill)}>
      {meta.label}
    </span>
  )
}
