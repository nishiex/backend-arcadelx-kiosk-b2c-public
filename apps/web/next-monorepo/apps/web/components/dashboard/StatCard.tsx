"use client"

import React from "react"
import { cn } from "@workspace/ui/lib/utils"
import CountUp from "./CountUp"

export type StatCardProps = {
  label: string
  value: number
  icon?: React.ReactNode
  hint?: string
  /** Tailwind classes for the icon container (bg + text), e.g. "bg-emerald-500/10 text-emerald-600". */
  iconClass?: string
  /** Colored dot class for the accent, e.g. "bg-emerald-500". */
  accent?: string
  /** Optional share-of-total (0–100) rendered as a thin real-data proportion bar. */
  pct?: number
  format?: (n: number) => string
  className?: string
}

/**
 * Premium KPI tile: tinted icon container, large metric, optional real
 * proportion bar. Number counts up (GSAP via CountUp); card lifts on hover.
 */
export default function StatCard({
  label,
  value,
  icon,
  hint,
  iconClass,
  accent,
  pct,
  format,
  className,
}: StatCardProps) {
  const barRef = React.useRef<HTMLSpanElement>(null)

  return (
    <div
      data-reveal
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-5",
        "shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md hover:border-border/80",
        className
      )}
    >
      {/* faint corner glow that warms up on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-primary/[0.04] blur-2xl transition-opacity duration-300 group-hover:bg-primary/[0.08]"
      />

      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {icon && (
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-105",
              iconClass ?? "bg-primary/10 text-primary"
            )}
          >
            {icon}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-end gap-2">
        <span className="text-[2rem] font-semibold leading-none tracking-tight tabular-nums">
          <CountUp value={value} format={format} />
        </span>
        {accent && <span className={cn("mb-1.5 h-2 w-2 rounded-full", accent)} />}
      </div>

      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}

      {typeof pct === "number" && (
        <div className="mt-auto pt-4">
          <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Share of fleet</span>
            <span className="tabular-nums">{Math.round(pct)}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <span
              ref={barRef}
              className={cn("block h-full origin-left rounded-full", accent ?? "bg-primary")}
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
        </div>
      )}

      {/* bottom accent line grows on hover */}
      <span className="absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 bg-primary/50 transition-transform duration-300 group-hover:scale-x-100" />
    </div>
  )
}
