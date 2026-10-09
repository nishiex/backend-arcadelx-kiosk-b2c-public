"use client"

import React from "react"
import { useQuery } from "@tanstack/react-query"
import { TrendingUp } from "lucide-react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  fetchRevenueSeries,
  REVENUE_SERIES_RANGES,
  type RevenueSeriesPoint,
  type RevenueSeriesRange,
} from "@/lib/backend-api"
import { prefersReducedMotion } from "@/lib/gsap"
import { Panel, Skeleton, ErrorState, EmptyState } from "./ui"

const RANGE_LABELS: Record<RevenueSeriesRange, string> = {
  "7d": "7D",
  "30d": "30D",
  "3m": "3M",
  "1y": "1Y",
}

const RANGE_DESCRIPTIONS: Record<RevenueSeriesRange, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "3m": "Last 3 months",
  "1y": "Last 12 months",
}

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
})

const compactInr = new Intl.NumberFormat("en-IN", {
  notation: "compact",
  maximumFractionDigits: 1,
})

/** Axis ticks stay short (`₹12K`) while the tooltip shows the exact amount. */
const axisTick = (value: number) => `₹${compactInr.format(value)}`

/**
 * The design tokens are plain CSS custom properties holding `oklch()` values, so a
 * token must be consumed as a whole value. Wrapping one in `hsl(...)` — as the older
 * dashboard charts do — is invalid CSS and silently falls back to the browser
 * default, which is why chart colours rendered grey in both themes.
 */
const themeColor = (token: `--${string}`) => `var(${token})`

const AXIS_TICK = { fontSize: 12, fill: themeColor("--muted-foreground") }

/**
 * Range filter. Buttons mirror the tab styling used elsewhere on the dashboard
 * and expose their state to assistive tech via aria-pressed.
 */
function RangeFilter({
  range,
  onChange,
  disabled,
}: {
  range: RevenueSeriesRange
  onChange: (range: RevenueSeriesRange) => void
  disabled: boolean
}) {
  return (
    <div
      className="flex shrink-0 gap-1 rounded-lg border border-border bg-muted/40 p-1"
      role="group"
      aria-label="Revenue range"
    >
      {REVENUE_SERIES_RANGES.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={range === value}
          disabled={disabled}
          onClick={() => onChange(value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            range === value
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {RANGE_LABELS[value]}
        </button>
      ))}
    </div>
  )
}

export default function RevenueTrendChart() {
  const [range, setRange] = React.useState<RevenueSeriesRange>("30d")
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["revenue-series", range],
    queryFn: ({ signal }) => fetchRevenueSeries(range, signal),
  })

  const points: RevenueSeriesPoint[] = data?.points ?? []
  const total = data?.total ?? 0
  // Every bucket is returned by the API, so an all-zero series means no revenue
  // was recorded in the window rather than "nothing loaded".
  const hasRevenue = points.some((point) => point.revenue > 0)
  const animate = !prefersReducedMotion()
  // useId can contain colons, which are awkward inside url(#...), so strip them.
  const gradientId = `revenue-trend-${React.useId().replace(/:/g, "")}`

  return (
    <Panel
      title="Revenue trend"
      subtitle={
        isLoading || isError
          ? RANGE_DESCRIPTIONS[range]
          : `Gross revenue · ${RANGE_DESCRIPTIONS[range]} · ${data?.granularity ?? ""}`.trim()
      }
      className="flex h-full flex-col"
      action={<RangeFilter range={range} onChange={setRange} disabled={isLoading} />}
    >
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-[248px] w-full" />
        </div>
      ) : isError ? (
        <ErrorState message="Couldn't load the revenue trend." onRetry={() => refetch()} />
      ) : !hasRevenue ? (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tracking-tight tabular-nums">
              {inr.format(0)}
            </span>
            <span className="text-xs text-muted-foreground">gross · INR</span>
          </div>
          <EmptyState
            className="py-10"
            icon={<TrendingUp size={28} />}
            message={`No revenue recorded in ${RANGE_DESCRIPTIONS[range].toLowerCase()}.`}
          />
        </>
      ) : (
        <div aria-busy={isFetching}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-2xl font-semibold tracking-tight tabular-nums">
              {inr.format(total)}
            </span>
            <span className="text-xs text-muted-foreground">
              gross · {points.length} {data?.bucket === "day" ? "days" : data?.bucket === "week" ? "weeks" : "months"} · INR
            </span>
          </div>
          <div
            className="mt-4 h-[248px] w-full"
            role="img"
            aria-label={`Gross revenue for ${RANGE_DESCRIPTIONS[range].toLowerCase()}, ${inr.format(total)} in total`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  {/* Instance-scoped id so two charts cannot share a gradient. */}
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={themeColor("--primary")} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={themeColor("--primary")} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={themeColor("--border")} />
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  tick={AXIS_TICK}
                  tickMargin={10}
                  minTickGap={24}
                  interval="preserveStartEnd"
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={AXIS_TICK}
                  tickFormatter={axisTick}
                  width={64}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: themeColor("--card"),
                    borderColor: themeColor("--border"),
                    borderRadius: "8px",
                    fontSize: 12,
                    color: themeColor("--card-foreground"),
                  }}
                  labelStyle={{ color: themeColor("--muted-foreground") }}
                  formatter={(value) => [inr.format(Number(value)), "Gross revenue"]}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="Gross revenue"
                  stroke={themeColor("--primary")}
                  strokeWidth={2}
                  fill={`url(#${gradientId})`}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                  isAnimationActive={animate}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Panel>
  )
}
