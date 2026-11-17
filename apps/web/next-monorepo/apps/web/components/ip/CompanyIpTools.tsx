"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { fetchAvailableIpGameIds, fetchCompanyIpDailyRevenue, fetchCompanyIpSettlements, fetchIpPartyGames, createIpGame, updateIpPercentage, triggerIpDailyAggregation, triggerIpMonthlySettlements } from "@/lib/ip-api"
import { EmptyState, Panel } from "@/components/dashboard/ui"
import { useState } from "react"

export default function CompanyIpTools({ party }: { party: { id: string; name: string; ipSharePct?: number } }) {
  const [tab, setTab] = useState<"games" | "revenue" | "settlements" | "commercial">("games")
  const games = useQuery({ queryKey: ["company-ip-games", party.id], queryFn: () => fetchIpPartyGames(party.id) })
  const observed = useQuery({ queryKey: ["company-ip-observed", party.id], queryFn: () => fetchAvailableIpGameIds(party.id) })
  const revenue = useQuery({ queryKey: ["company-ip-revenue", party.id], queryFn: () => fetchCompanyIpDailyRevenue(party.id) })
  const settlements = useQuery({ queryKey: ["company-ip-settlements", party.id], queryFn: () => fetchCompanyIpSettlements(party.id) })
  const action = useMutation({ mutationFn: async (kind: string) => {
    if (kind === "aggregate") return triggerIpDailyAggregation({ lookbackDays: 0 })
    if (kind === "settle") { const now = new Date(); return triggerIpMonthlySettlements({ month: now.getMonth() + 1, year: now.getFullYear() }) }
    if (kind === "royalty") return updateIpPercentage(party.id, { ipSharePct: Number(prompt("New IP royalty percentage", String(party.ipSharePct ?? 60))) })
    const displayName = prompt("Game display name"); const gameIdentifier = prompt("Observed game identifier")
    if (!displayName || !gameIdentifier) throw new Error("Display name and game identifier are required")
    return createIpGame(party.id, { displayName, gameIdentifier })
  }, onSuccess: () => { toast.success("IP action completed"); void games.refetch(); void observed.refetch(); void revenue.refetch(); void settlements.refetch() }, onError: (error: Error) => toast.error(error.message) })

  return <Panel title={`${party.name} · IP management`} subtitle="Games, revenue, settlements and commercial terms">
    <div className="mb-4 flex flex-wrap gap-2 border-b border-border pb-3" role="tablist" aria-label="IP management sections">
      {([["games", "Games"], ["revenue", "Daily revenue"], ["settlements", "Settlements"], ["commercial", "Commercial terms"]] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} type="button" onClick={() => setTab(value)} className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${tab === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{label}</button>)}
    </div>
    <div className="flex flex-wrap gap-2">
      {tab === "games" && <><button className="rounded-lg border px-3 py-2 text-sm" onClick={() => void games.refetch()}>Refresh games</button><button className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={() => action.mutate("game")}>Register game</button></>}
      {tab === "revenue" && <><button className="rounded-lg border px-3 py-2 text-sm" onClick={() => void revenue.refetch()}>Refresh daily revenue</button><button className="rounded-lg border px-3 py-2 text-sm" onClick={() => action.mutate("aggregate")}>Aggregate daily revenue</button></>}
      {tab === "settlements" && <><button className="rounded-lg border px-3 py-2 text-sm" onClick={() => void settlements.refetch()}>Refresh settlements</button><button className="rounded-lg border px-3 py-2 text-sm" onClick={() => action.mutate("settle")}>Trigger monthly settlements</button></>}
      {tab === "commercial" && <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => action.mutate("royalty")}>Change royalty</button>}
    </div>
    {tab === "games" && <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <div><h3 className="mb-2 text-sm font-semibold">Observed game IDs</h3>{(observed.data?.availableGameIds ?? []).length === 0 ? <EmptyState message="No unregistered observed games" /> : <ul className="space-y-1 text-sm">{observed.data?.availableGameIds.map(game => <li key={game.gameId} className="rounded border p-2">{game.gameId} <span className="text-xs text-muted-foreground">({game.transactionCount} transactions)</span></li>)}</ul>}</div>
      <div><h3 className="mb-2 text-sm font-semibold">Registered games</h3>{(games.data ?? []).length === 0 ? <EmptyState message="No games" /> : <ul className="space-y-1 text-sm">{games.data?.map(game => <li key={game.id} className="rounded border p-2">{game.displayName}<span className="block text-xs text-muted-foreground">{game.gameIdentifier} · {game.status}</span></li>)}</ul>}</div>
    </div>}
    {tab === "revenue" && <div className="mt-5"><h3 className="mb-2 text-sm font-semibold">Daily revenue</h3><p className="text-sm">Gross: ₹{revenue.data?.summary.totalGrossRevenue ?? "0.00"}</p><p className="text-sm">IP royalty: ₹{revenue.data?.summary.totalIpRoyaltyShare ?? "0.00"}</p><p className="mt-3 text-xs text-muted-foreground">Status: {revenue.data?.aggregationStatus ?? "Loading"}</p></div>}
    {tab === "settlements" && <div className="mt-5"><h3 className="mb-2 text-sm font-semibold">Settlements</h3>{(settlements.data ?? []).length === 0 ? <EmptyState message="No settlements" /> : <div className="space-y-1 text-sm">{settlements.data?.map(settlement => <div key={settlement.id} className="flex justify-between rounded border p-2"><span>{settlement.month}/{settlement.year} · {settlement.status}</span><span>₹{settlement.finalPayout}</span></div>)}</div>}</div>}
    {tab === "commercial" && <div className="mt-5 rounded-lg border border-border p-4 text-sm"><p>Current IP royalty: <strong>{party.ipSharePct ?? "—"}%</strong></p><p className="mt-1 text-muted-foreground">Use Change royalty to create a new effective agreement.</p></div>}
  </Panel>
}
