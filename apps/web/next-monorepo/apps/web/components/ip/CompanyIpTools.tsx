"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { fetchAvailableIpGameIds, fetchCompanyIpDailyRevenue, fetchCompanyIpSettlements, fetchIpPartyGames, createIpGame, updateIpPercentage, triggerIpDailyAggregation, triggerIpMonthlySettlements } from "@/lib/ip-api"
import { EmptyState, Panel } from "@/components/dashboard/ui"
import { useState } from "react"
import type { FormEvent } from "react"

export default function CompanyIpTools({ party }: { party: { id: string; name: string; ipSharePct?: number } }) {
  const [tab, setTab] = useState<"games" | "revenue" | "settlements" | "commercial">("games")
  const [showGameForm, setShowGameForm] = useState(false)
  const [showRoyaltyForm, setShowRoyaltyForm] = useState(false)
  const [gameName, setGameName] = useState("")
  const [gameIdentifier, setGameIdentifier] = useState("")
  const [royalty, setRoyalty] = useState(String(party.ipSharePct ?? 60))
  const [date, setDate] = useState(() => new Date(Date.now() - 86400000).toISOString().slice(0, 10))
  const [month, setMonth] = useState(String(new Date().getMonth() + 1))
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [lookbackDays, setLookbackDays] = useState("0")
  const [force, setForce] = useState(false)
  const games = useQuery({ queryKey: ["company-ip-games", party.id], queryFn: () => fetchIpPartyGames(party.id) })
  const observed = useQuery({ queryKey: ["company-ip-observed", party.id], queryFn: () => fetchAvailableIpGameIds(party.id) })
  const revenue = useQuery({ queryKey: ["company-ip-revenue", party.id, date], queryFn: () => fetchCompanyIpDailyRevenue(party.id, date) })
  const settlements = useQuery({ queryKey: ["company-ip-settlements", party.id], queryFn: () => fetchCompanyIpSettlements(party.id) })
  const action = useMutation({ mutationFn: async (input: { kind: string; displayName?: string; gameIdentifier?: string; ipSharePct?: number }) => {
    const { kind } = input
    if (kind === "aggregate") return triggerIpDailyAggregation({ date, lookbackDays: Number(lookbackDays) })
    if (kind === "settle") return triggerIpMonthlySettlements({ month: Number(month), year: Number(year), force })
    if (kind === "royalty") return updateIpPercentage(party.id, { ipSharePct: input.ipSharePct! })
    return createIpGame(party.id, { displayName: input.displayName!, gameIdentifier: input.gameIdentifier! })
  }, onSuccess: () => { toast.success("IP action completed"); setShowGameForm(false); setShowRoyaltyForm(false); setGameName(""); setGameIdentifier(""); void games.refetch(); void observed.refetch(); void revenue.refetch(); void settlements.refetch() }, onError: (error: Error) => toast.error(error.message) })

  function submitGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (gameName.trim().length < 2 || gameIdentifier.trim().length < 2) { toast.error("Enter a game name and identifier, each at least 2 characters"); return }
    action.mutate({ kind: "game", displayName: gameName.trim(), gameIdentifier: gameIdentifier.trim() })
  }

  function submitRoyalty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = Number(royalty)
    if (!Number.isFinite(value) || value < 0 || value > 100) { toast.error("Royalty must be a number from 0 to 100"); return }
    action.mutate({ kind: "royalty", ipSharePct: value })
  }

  return <Panel title={`${party.name} · IP management`} subtitle="Games, revenue, settlements and commercial terms">
    <div className="mb-4 flex flex-wrap gap-2 border-b border-border pb-3" role="tablist" aria-label="IP management sections">
      {([["games", "Games"], ["revenue", "Daily revenue"], ["settlements", "Settlements"], ["commercial", "Commercial terms"]] as const).map(([value, label]) => <button key={value} role="tab" aria-selected={tab === value} type="button" onClick={() => setTab(value)} className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${tab === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{label}</button>)}
    </div>
    <div className="flex flex-wrap gap-2">
      {tab === "games" && <><button className="rounded-lg border px-3 py-2 text-sm" onClick={() => void games.refetch()}>Refresh games</button><button className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={() => setShowGameForm(value => !value)}>Register game</button></>}
      {tab === "revenue" && <><label className="text-xs">Date<input type="date" value={date} onChange={event => setDate(event.target.value)} className="ml-2 rounded border px-2 py-1 text-sm" /></label><label className="text-xs">Lookback<input type="number" min="0" value={lookbackDays} onChange={event => setLookbackDays(event.target.value)} className="ml-2 w-20 rounded border px-2 py-1 text-sm" /></label><button className="rounded-lg border px-3 py-2 text-sm" onClick={() => void revenue.refetch()}>Refresh daily revenue</button><button className="rounded-lg border px-3 py-2 text-sm" onClick={() => action.mutate({ kind: "aggregate" })}>Aggregate daily revenue</button></>}
      {tab === "settlements" && <><label className="text-xs">Month<input type="number" min="1" max="12" value={month} onChange={event => setMonth(event.target.value)} className="ml-2 w-16 rounded border px-2 py-1 text-sm" /></label><label className="text-xs">Year<input type="number" min="2020" max="2100" value={year} onChange={event => setYear(event.target.value)} className="ml-2 w-24 rounded border px-2 py-1 text-sm" /></label><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={force} onChange={event => setForce(event.target.checked)} /> Force</label><button className="rounded-lg border px-3 py-2 text-sm" onClick={() => void settlements.refetch()}>Refresh settlements</button><button className="rounded-lg border px-3 py-2 text-sm" onClick={() => action.mutate({ kind: "settle" })}>Trigger monthly settlements</button></>}
      {tab === "commercial" && <button className="rounded-lg border px-3 py-2 text-sm" onClick={() => setShowRoyaltyForm(value => !value)}>Change royalty</button>}
    </div>
    {showGameForm && tab === "games" && <form onSubmit={submitGame} className="mt-4 grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2"><label className="text-sm">Display name<input value={gameName} onChange={event => setGameName(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="Space Racer" required minLength={2} /></label><label className="text-sm">Game identifier<input value={gameIdentifier} onChange={event => setGameIdentifier(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="space-racer" required minLength={2} /></label><div className="flex gap-2 sm:col-span-2"><button type="submit" disabled={action.isPending} className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">{action.isPending ? "Saving…" : "Save game"}</button><button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => setShowGameForm(false)}>Cancel</button></div></form>}
    {showRoyaltyForm && tab === "commercial" && <form onSubmit={submitRoyalty} className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-border p-4"><label className="text-sm">IP royalty percentage<input value={royalty} onChange={event => setRoyalty(event.target.value)} type="number" min="0" max="100" step="0.01" className="mt-1 block w-40 rounded-lg border px-3 py-2" required /></label><button type="submit" disabled={action.isPending} className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">{action.isPending ? "Saving…" : "Save percentage"}</button><button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => setShowRoyaltyForm(false)}>Cancel</button></form>}
    {tab === "games" && <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <div><h3 className="mb-2 text-sm font-semibold">Observed game IDs</h3>{(observed.data?.availableGameIds ?? []).length === 0 ? <EmptyState message="No unregistered observed games" /> : <ul className="space-y-1 text-sm">{observed.data?.availableGameIds.map(game => <li key={game.gameId} className="rounded border p-2"><button type="button" className="text-left" onClick={() => { setGameIdentifier(game.normalizedGameIdentifier); setGameName(game.suggestedDisplayName); setShowGameForm(true) }}>{game.gameId} <span className="text-xs text-muted-foreground">({game.transactionCount} transactions)</span></button></li>)}</ul>}</div>
      <div><h3 className="mb-2 text-sm font-semibold">Registered games</h3>{(games.data ?? []).length === 0 ? <EmptyState message="No games" /> : <ul className="space-y-1 text-sm">{games.data?.map(game => <li key={game.id} className="rounded border p-2">{game.displayName}<span className="block text-xs text-muted-foreground">{game.gameIdentifier} · {game.status}</span></li>)}</ul>}</div>
    </div>}
      {tab === "revenue" && <div className="mt-5"><h3 className="mb-2 text-sm font-semibold">Daily revenue · {date}</h3>{revenue.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : revenue.isError ? <p className="text-sm text-destructive">Could not load daily revenue.</p> : <><p className="text-sm">Gross: ₹{revenue.data?.summary.totalGrossRevenue ?? "0.00"}</p><p className="text-sm">IP royalty: ₹{revenue.data?.summary.totalIpRoyaltyShare ?? "0.00"}</p><div className="mt-4 space-y-1 text-sm">{revenue.data?.games.map(game => <div key={game.gameId} className="flex justify-between rounded border p-2"><span>{game.displayName} · {game.kioskCount} kiosks</span><span>₹{game.ipRoyaltyShare}</span></div>)}</div><p className="mt-3 text-xs text-muted-foreground">Status: {revenue.data?.aggregationStatus ?? "Loading"}</p></>}</div>}
    {tab === "settlements" && <div className="mt-5"><h3 className="mb-2 text-sm font-semibold">Settlements</h3>{settlements.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : settlements.isError ? <p className="text-sm text-destructive">Could not load settlements.</p> : (settlements.data ?? []).length === 0 ? <EmptyState message="No settlements" /> : <div className="space-y-2 text-sm">{settlements.data?.map(settlement => <details key={settlement.id} className="rounded border p-2"><summary className="flex cursor-pointer justify-between"><span>{settlement.month}/{settlement.year} · {settlement.status}</span><span>₹{settlement.finalPayout}</span></summary>{settlement.lines && <div className="mt-2 space-y-1 border-t pt-2">{settlement.lines.map(line => <div key={line.gameIdentifier} className="flex justify-between text-xs"><span>{line.gameDisplayName} · {line.kioskCount} kiosks</span><span>₹{line.ipRoyaltyShare}</span></div>)}</div>}</details>)}</div>}</div>}
    {tab === "commercial" && <div className="mt-5 rounded-lg border border-border p-4 text-sm"><p>Current IP royalty: <strong>{party.ipSharePct ?? "—"}%</strong></p><p className="mt-1 text-muted-foreground">Use Change royalty to create a new effective agreement.</p></div>}
  </Panel>
}
