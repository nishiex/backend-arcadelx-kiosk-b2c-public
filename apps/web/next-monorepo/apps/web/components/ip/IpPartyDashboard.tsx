"use client"

import { useQuery } from "@tanstack/react-query"
import { CalendarDays, Download, Gamepad2, RefreshCw } from "lucide-react"
import { fetchMyIpDailyRevenue, fetchMyIpGames, fetchMyIpSettlements, downloadMyIpSettlement } from "@/lib/ip-api"
import { EmptyState, ErrorState, Panel, Skeleton } from "@/components/dashboard/ui"

const money = (value: unknown) => `₹${Number(value ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function IpPartyDashboard() {
  const games = useQuery({ queryKey: ["ip-my-games"], queryFn: fetchMyIpGames })
  const revenue = useQuery({ queryKey: ["ip-daily-revenue"], queryFn: () => fetchMyIpDailyRevenue() })
  const settlements = useQuery({ queryKey: ["ip-settlements"], queryFn: () => fetchMyIpSettlements() })

  if (games.isLoading || revenue.isLoading || settlements.isLoading) return <Skeleton className="h-64 w-full" />
  if (games.isError || revenue.isError || settlements.isError) return <ErrorState message="Couldn't load IP dashboard" onRetry={() => { void games.refetch(); void revenue.refetch(); void settlements.refetch() }} />

  const gameRows = games.data ?? []
  const daily = revenue.data
  const settlementRows = settlements.data ?? []
  if (!daily) return <ErrorState message="Daily revenue is unavailable" onRetry={() => void revenue.refetch()} />

  const summary = daily.summary
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">IP Party workspace</p>
        <h1 className="text-2xl font-semibold tracking-tight">Games & royalties</h1>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Today's gross revenue", money(summary.totalGrossRevenue)],
          ["Your royalty", money(summary.totalIpRoyaltyShare)],
          ["Kiosks", String(summary.totalKioskCount ?? 0)],
          ["Games with revenue", String(summary.totalGames ?? 0)],
        ].map(([label, value]) => <Panel key={label} className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-xl font-semibold">{value}</p></Panel>)}
      </div>

      <Panel className="p-5">
        <div className="mb-4 flex items-center gap-2"><Gamepad2 size={18} /><h2 className="font-semibold">My games</h2></div>
        {gameRows.length === 0 ? <EmptyState message="No games registered yet" /> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{gameRows.map(game => <div key={game.id} className="rounded-xl border border-border p-4"><p className="font-medium">{game.displayName}</p><p className="mt-1 text-xs text-muted-foreground">{game.gameIdentifier}</p><p className="mt-3 text-xs text-muted-foreground">Status: {game.status}</p></div>)}</div>}
      </Panel>

      <Panel className="p-5">
        <div className="mb-4 flex items-center justify-between"><div className="flex items-center gap-2"><CalendarDays size={18} /><h2 className="font-semibold">Daily revenue · {daily.businessDate}</h2></div><span className="text-xs text-muted-foreground">{daily.aggregationStatus}</span></div>
        {daily.games.length === 0 ? <EmptyState message="No revenue for the latest completed day" /> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs uppercase text-muted-foreground"><th className="px-3 py-2">Game</th><th className="px-3 py-2">Kiosks</th><th className="px-3 py-2">Gross</th><th className="px-3 py-2">Royalty</th></tr></thead><tbody>{daily.games.map(game => <tr key={game.gameId} className="border-b last:border-0"><td className="px-3 py-3">{game.displayName}</td><td className="px-3 py-3">{game.kioskCount}</td><td className="px-3 py-3">{money(game.grossRevenue)}</td><td className="px-3 py-3">{money(game.ipRoyaltyShare)}</td></tr>)}</tbody></table></div>}
      </Panel>

      <Panel className="p-5"><div className="mb-4 flex items-center gap-2"><RefreshCw size={18} /><h2 className="font-semibold">Monthly settlements</h2></div>{settlementRows.length === 0 ? <EmptyState message="No settlements generated yet" /> : <div className="space-y-2">{settlementRows.map(settlement => <div key={settlement.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-4"><div><p className="font-medium">{settlement.month}/{settlement.year}</p><p className="text-xs text-muted-foreground">{settlement.status} · {settlement.linesCount ?? 0} games</p></div><div className="text-right"><p className="font-semibold">{money(settlement.finalPayout)}</p>{settlement.hasPdf && <button className="mt-1 inline-flex items-center gap-1 text-xs text-primary" onClick={async () => { const blob = await downloadMyIpSettlement(settlement.id); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `settlement-${settlement.year}-${settlement.month}.pdf`; a.click(); URL.revokeObjectURL(url) }}><Download size={13} /> Download PDF</button>}</div></div>)}</div>}</Panel>
    </div>
  )
}
