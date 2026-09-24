"use client"

import React from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowDownLeft, CreditCard, FileText } from "lucide-react"
import { fetchPayments } from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"
import { useReveal } from "@/hooks/useReveal"
import { Skeleton, ErrorState, EmptyState } from "@/components/dashboard/ui"

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
})
const money = (n: number) => inr.format(n)
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB")

export default function PaymentsScreen() {
  const { isCompany } = useMe()
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["payments"],
    queryFn: fetchPayments,
  })

  const payments = data?.payments ?? []
  const totalReceived = data?.totalReceived ?? 0
  const bodyRef = useReveal<HTMLTableSectionElement>([payments.length])

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payments</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isCompany
            ? "All settlement payments issued to your distributors."
            : "Track all incoming payments from the Company."}
        </p>
      </div>

      {/* Total card */}
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <ArrowDownLeft size={20} />
          </span>
          <div>
            <div className="text-sm font-semibold">{isCompany ? "Total Paid Out" : "Total Received"}</div>
            <div className="text-xs text-muted-foreground">
              {isCompany ? "Across all distributors" : "From Company settlements"}
            </div>
          </div>
        </div>
        <div className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
          {money(totalReceived)}
        </div>
      </div>

      {/* Payments table */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-3.5 text-sm font-semibold">
          {isCompany ? "Payments Issued to Distributors" : "Payments Received from Company"}
        </div>
        {isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState className="py-12" message="Couldn't load payments." onRetry={() => refetch()} />
        ) : !payments.length ? (
          <EmptyState
            className="py-14"
            icon={<CreditCard size={30} />}
            message="No payments recorded yet."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-3 font-medium">Payment ID</th>
                  <th className="px-5 py-3 font-medium">Date</th>
                  {isCompany && <th className="px-5 py-3 font-medium">Distributor</th>}
                  <th className="px-5 py-3 font-medium">Settlement Ref</th>
                  <th className="px-5 py-3 font-medium">Method</th>
                  <th className="px-5 py-3 font-medium">Transaction Ref</th>
                  <th className="px-5 py-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody ref={bodyRef}>
                {payments.map((p) => (
                  <tr
                    key={p.id}
                    data-reveal
                    className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-5 py-3 font-mono text-xs">{p.reference}</td>
                    <td className="px-5 py-3 text-muted-foreground">{fmtDate(p.paidAt)}</td>
                    {isCompany && <td className="px-5 py-3">{p.organization.name}</td>}
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-1.5 text-primary">
                        <FileText size={13} />
                        {p.settlement?.reference ?? "—"}
                      </span>
                    </td>
                    <td className="px-5 py-3">{p.method}</td>
                    <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                      {p.transactionRef ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {money(p.amount)}
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
