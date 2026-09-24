"use client"

import React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { FileText, Loader2, RefreshCw } from "lucide-react"
import { fetchSettlements, generateSettlements, type SettlementStatus } from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"
import { useReveal } from "@/hooks/useReveal"
import { Skeleton, ErrorState, EmptyState } from "@/components/dashboard/ui"

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
})
const money = (n: number) => inr.format(n)
const periodLabel = (y: number, m: number) =>
  new Date(y, m - 1).toLocaleString("en-US", { month: "long", year: "numeric" })

function monthOptions() {
  const opts: { year: number; month: number; label: string }[] = []
  const now = new Date()
  for (let i = 0; i < 12; i++) {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1)
    opts.push({ year: dt.getFullYear(), month: dt.getMonth() + 1, label: periodLabel(dt.getFullYear(), dt.getMonth() + 1) })
  }
  return opts
}

const statusStyles: Record<SettlementStatus, string> = {
  PENDING: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  PAID: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
}

export default function SettlementsScreen() {
  const { isCompany, canManageDistributors } = useMe()
  const qc = useQueryClient()
  const months = React.useMemo(monthOptions, [])
  const first = months[0]!
  const [sel, setSel] = React.useState(`${first.year}-${first.month}`)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["settlements"],
    queryFn: fetchSettlements,
  })

  const gen = useMutation({
    mutationFn: () => {
      const [y, m] = sel.split("-").map(Number)
      return generateSettlements(y!, m!)
    },
    onSuccess: (res) => {
      toast.success(res.count ? `Generated ${res.count} settlement${res.count === 1 ? "" : "s"}` : "No revenue to settle for that month")
      qc.invalidateQueries({ queryKey: ["settlements"] })
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't generate settlements"),
  })

  const settlements = data ?? []
  const bodyRef = useReveal<HTMLTableSectionElement>([settlements.length])

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settlements</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Monthly revenue-share payout runs{isCompany ? " across your distributor network." : " for your organization."}
          </p>
        </div>
        {canManageDistributors && (
          <div className="flex items-end gap-2">
            <select
              className="rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              value={sel}
              onChange={(e) => setSel(e.target.value)}
            >
              {months.map((m) => (
                <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>{m.label}</option>
              ))}
            </select>
            <button
              onClick={() => gen.mutate()}
              disabled={gen.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
            >
              {gen.isPending ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              Generate
            </button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState className="py-12" message="Couldn't load settlements." onRetry={() => refetch()} />
        ) : !settlements.length ? (
          <EmptyState
            className="py-14"
            icon={<FileText size={30} />}
            message={
              canManageDistributors
                ? "No settlements yet. Pick a month and Generate to roll up recorded revenue."
                : "No settlements to show yet."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Reference</th>
                  {isCompany && <th className="px-5 py-3 font-medium">Distributor</th>}
                  <th className="px-5 py-3 font-medium">Period</th>
                  <th className="px-5 py-3 text-right font-medium">Gross</th>
                  <th className="px-5 py-3 text-right font-medium">Company Share</th>
                  <th className="px-5 py-3 text-right font-medium">Distributor Share</th>
                  <th className="px-5 py-3 text-right font-medium">Paid</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody ref={bodyRef}>
                {settlements.map((s) => (
                  <tr
                    key={s.id}
                    data-reveal
                    className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-5 py-3 font-mono text-xs">{s.reference}</td>
                    {isCompany && <td className="px-5 py-3">{s.organization.name}</td>}
                    <td className="px-5 py-3 text-muted-foreground">{periodLabel(s.year, s.month)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{money(s.grossRevenue)}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{money(s.companyShare)}</td>
                    <td className="px-5 py-3 text-right font-medium tabular-nums text-primary">{money(s.distributorShare)}</td>
                    <td className="px-5 py-3 text-right tabular-nums">{money(s.paidToDate)}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[s.status]}`}>
                        {s.status === "PAID" ? "Paid" : "Pending"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
