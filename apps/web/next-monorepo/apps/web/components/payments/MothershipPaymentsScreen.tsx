"use client"

import { useQuery } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"
import { useMe } from "@/hooks/useMe"
import { fetchMothershipPayments } from "@/lib/backend-api"
import { EmptyState, ErrorState, Panel, Skeleton } from "@/components/dashboard/ui"

const buttonClass = "rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"

export default function MothershipPaymentsScreen() {
  const { isLoading, isError, canViewRevenue, isCompany, role } = useMe()
  const canRead = canViewRevenue && isCompany && (role === "OWNER" || role === "ADMIN")
  const payments = useQuery({
    queryKey: ["mothership-payments", "local-screen"],
    queryFn: ({ signal }) => fetchMothershipPayments(1, signal),
    enabled: canRead,
    staleTime: 30_000,
    retry: 1,
  })

  if (isLoading) return <Skeleton className="h-64 w-full" />
  if (isError) return <ErrorState message="Unable to verify your access. Refresh the page to try again." />
  if (!canRead) return <EmptyState message="Mothership payments are available to Company Owners and Admins." />

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mothership payments</h1>
          <p className="mt-1 text-sm text-muted-foreground">Live payment records shown locally from the Mothership feed. No local import is performed here.</p>
        </div>
        <button className={buttonClass} disabled={payments.isFetching} onClick={() => void payments.refetch()}>
          <span className="flex items-center gap-2"><RefreshCw size={16} className={payments.isFetching ? "animate-spin" : ""} />{payments.isFetching ? "Refreshing…" : "Refresh"}</span>
        </button>
      </header>
      <Panel title="Latest payments" subtitle="The feed returns the newest 50 records; 10 are shown per page.">
        {payments.isPending ? <Skeleton className="h-20 w-full" /> : payments.isError ? <ErrorState message={payments.error.message} onRetry={() => void payments.refetch()} /> : !payments.data.payments.length ? <EmptyState message="No payments were returned by Mothership." /> : (
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-sm"><caption className="sr-only">Mothership payment records</caption><thead><tr className="border-b border-border text-left text-muted-foreground">{["Date", "Transaction", "Device", "Game", "Amount", "Status", "Provider"].map((label) => <th scope="col" key={label} className="px-3 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{payments.data.payments.map((payment) => <tr key={payment.txnid} className="border-b border-border/60 last:border-0"><td className="px-3 py-3">{new Date(payment.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td><th scope="row" className="px-3 py-3 text-left font-medium">{payment.txnid}</th><td className="px-3 py-3">{payment.device_id}</td><td className="px-3 py-3">{payment.game_id}</td><td className="px-3 py-3 tabular-nums">{new Intl.NumberFormat("en-IN", { style: "currency", currency: payment.currency }).format(payment.amount)}</td><td className="px-3 py-3">{payment.status}</td><td className="px-3 py-3">{payment.provider ?? "—"}</td></tr>)}</tbody></table>
            <p className="mt-3 text-xs text-muted-foreground">{payments.data.total} payments · fetched {new Date(payments.data.fetchedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</p>
          </div>
        )}
      </Panel>
    </div>
  )
}
