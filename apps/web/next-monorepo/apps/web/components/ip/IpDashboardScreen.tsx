"use client"

import React from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  ArrowUpRight,
  Building2,
  Download,
  Gamepad2,
  IndianRupee,
  Monitor,
  ReceiptText,
  Sparkles,
} from "lucide-react"
import { useMe } from "@/hooks/useMe"
import { useReveal } from "@/hooks/useReveal"
import StatCard from "@/components/dashboard/StatCard"
import { EmptyState, ErrorState, Panel, Skeleton } from "@/components/dashboard/ui"
import IpPartyGameKiosksModal from "@/components/ip/IpPartyGameKiosksModal"
import {
  downloadMyIpSettlement,
  fetchMyIpDailyRevenue,
  fetchMyIpGames,
  fetchMyIpSettlements,
  type IpGame,
  type IpSettlement,
} from "@/lib/ip-api"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// Same grouping and currency shapes as the operator dashboard, so a royalty figure
// reads identically wherever it appears in the product.
const nf = new Intl.NumberFormat("en-IN")
const money = (value: unknown) => `₹${nf.format(Math.round(Number(value ?? 0)))}`
const count = (value: number) => nf.format(Math.round(value))
const exactMoney = (value: unknown) =>
  `₹${Number(value ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Literal class strings so Tailwind can see them; one wash per catalogue position.
const COVER_GRADIENTS = [
  "from-blue-500 via-indigo-600 to-slate-900",
  "from-indigo-400 via-blue-600 to-slate-900",
  "from-violet-500 via-indigo-600 to-slate-900",
  "from-sky-500 via-blue-700 to-slate-900",
]

const statusPill = (status: string) => {
  const live = status.toUpperCase() === "ACTIVE"
  return live
    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    : "bg-muted text-muted-foreground"
}

// The greeting is browser-local, so the server snapshot stays neutral and the
// client resolves the real value during hydration.
const subscribeToClock = () => () => {}

function greetingFor(hour: number) {
  if (hour >= 5 && hour < 12) return "Good morning"
  if (hour >= 12 && hour < 17) return "Good afternoon"
  if (hour >= 17 && hour < 22) return "Good evening"
  return "Good night"
}

function useGreeting() {
  return React.useSyncExternalStore(
    subscribeToClock,
    () => greetingFor(new Date().getHours()),
    () => "Welcome"
  )
}

export default function IpDashboardScreen() {
  const { me, orgName } = useMe()
  const greeting = useGreeting()
  const [selectedGame, setSelectedGame] = React.useState<IpGame | null>(null)

  const games = useQuery({ queryKey: ["ip-my-games"], queryFn: fetchMyIpGames })
  const revenue = useQuery({ queryKey: ["ip-daily-revenue"], queryFn: () => fetchMyIpDailyRevenue() })
  const settlements = useQuery({ queryKey: ["ip-settlements"], queryFn: () => fetchMyIpSettlements() })

  const catalogueRef = useReveal<HTMLDivElement>([games.data?.length, revenue.data?.businessDate])

  async function downloadSettlement(settlement: IpSettlement) {
    try {
      const blob = await downloadMyIpSettlement(settlement.id)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `settlement-${settlement.year}-${settlement.month}.pdf`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't download the statement")
    }
  }

  if (games.isLoading || revenue.isLoading || settlements.isLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-6" aria-busy="true" aria-label="Loading IP dashboard">
        <Skeleton className="h-44 w-full rounded-2xl" />
        <div className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map(index => (
            <Skeleton key={index} className="h-[112px] rounded-2xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
        <Skeleton className="h-56 rounded-xl" />
      </div>
    )
  }

  if (games.isError || revenue.isError || settlements.isError || !revenue.data) {
    return (
      <div className="mx-auto max-w-7xl">
        <Panel title="IP dashboard">
          <ErrorState
            message="Couldn't load your royalty data."
            onRetry={() => {
              void games.refetch()
              void revenue.refetch()
              void settlements.refetch()
            }}
          />
        </Panel>
      </div>
    )
  }

  const daily = revenue.data
  const titleList = games.data ?? []
  const statements = settlements.data ?? []
  const summary = daily.summary
  const gross = Number(summary.totalGrossRevenue ?? 0)
  const royalty = Number(summary.totalIpRoyaltyShare ?? 0)
  const kiosks = Number(summary.totalKioskCount ?? 0)
  const titles = Number(summary.totalGames ?? titleList.length)
  const royaltyRate = gross > 0 ? Math.round((royalty / gross) * 100) : 0
  const maxGross = Math.max(...daily.games.map(game => Number(game.grossRevenue)), 0)
  const firstName = me?.name?.split(" ")[0] ?? "there"

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <section className="relative isolate overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-8">
        {/* Same layered background as the operator welcome card. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at 82% -30%, color-mix(in oklch, var(--color-primary) 14%, transparent), transparent 58%)",
            }}
          />
          <div
            className="absolute inset-0 opacity-[0.04] [mask-image:linear-gradient(to_right,transparent,black_30%,black_70%,transparent)]"
            style={{
              backgroundImage:
                "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
              backgroundSize: "28px 28px",
            }}
          />
        </div>

        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              <Sparkles size={12} className="text-primary" /> IP studio
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              {greeting}, {firstName}
            </h1>
            <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
              Royalty, kiosk reach and monthly statements for the titles you own.
            </p>

            {orgName && (
              <div className="mt-5 inline-flex items-center gap-2.5 rounded-full border border-border bg-background/60 py-1.5 pl-1.5 pr-4 backdrop-blur">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Building2 size={15} />
                </span>
                <span className="leading-tight">
                  <span className="block text-sm font-medium">{orgName}</span>
                  <span className="block text-[11px] tracking-wide text-muted-foreground">IP Partner</span>
                </span>
              </div>
            )}
          </div>

          <div className="w-full shrink-0 rounded-xl border border-border bg-background/60 p-4 backdrop-blur sm:max-w-xs">
            <p className="text-xs font-medium text-muted-foreground">Latest business day</p>
            <p className="mt-1 text-lg font-semibold tracking-tight tabular-nums">{daily.businessDate}</p>
            <p className="mt-2 inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {daily.aggregationStatus.toLowerCase().replaceAll("_", " ")}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              {kiosks} kiosks reported revenue across {titles} {titles === 1 ? "title" : "titles"}.
            </p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Gross revenue" value={gross} format={money} icon={<IndianRupee size={18} />} hint="For the latest business day" />
        <StatCard
          label="Your royalty"
          value={royalty}
          format={money}
          icon={<ReceiptText size={18} />}
          iconClass="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          hint={`${royaltyRate}% of gross`}
        />
        <StatCard
          label="Kiosks"
          value={kiosks}
          format={count}
          icon={<Monitor size={18} />}
          iconClass="bg-blue-500/10 text-blue-600 dark:text-blue-400"
          hint="Running your titles"
        />
        <StatCard
          label="Titles"
          value={titles}
          format={count}
          icon={<Gamepad2 size={18} />}
          iconClass="bg-violet-500/10 text-violet-600 dark:text-violet-400"
          hint="In your catalogue"
        />
      </div>

      <div ref={catalogueRef} className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div data-reveal className="min-w-0">
          <Panel
            title="Catalogue"
            subtitle="Titles registered to your studio"
            action={<span className="text-xs text-muted-foreground">{titleList.length} total</span>}
          >
            {titleList.length === 0 ? (
              <EmptyState
                icon={<Gamepad2 size={18} />}
                message="No games are registered to this studio yet. Contact ArcadeLX to have your titles added."
              />
            ) : (
              <div className="space-y-2">
                {titleList.map((game, index) => (
                  <div
                    key={game.id}
                    className="flex items-center gap-3 rounded-lg border border-border/60 p-2.5 transition-colors hover:bg-muted/40"
                  >
                    {game.coverImageUrl ? (
                      // Cover art comes from arbitrary hosts, so a plain img keeps next/image config out of this surface.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={game.coverImageUrl} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <div
                        aria-hidden
                        className={`h-11 w-11 shrink-0 rounded-lg bg-gradient-to-br ${COVER_GRADIENTS[index % COVER_GRADIENTS.length]}`}
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{game.displayName}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">{game.gameIdentifier}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusPill(game.status)}`}>
                      {game.status.toLowerCase()}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedGame(game)}
                      className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80"
                    >
                      Kiosks <ArrowUpRight size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div data-reveal className="min-w-0">
          <Panel
            title="Royalty by title"
            subtitle={daily.businessDate}
            action={<span className="text-xs text-muted-foreground">{daily.games.length} earning</span>}
          >
            {daily.games.length === 0 ? (
              <EmptyState message="No title earned revenue on the latest completed day." />
            ) : (
              <div className="divide-y divide-border">
                {daily.games.map(game => {
                  const share = maxGross > 0 ? Math.max(3, Math.round((Number(game.grossRevenue) / maxGross) * 100)) : 0
                  return (
                    <div key={game.gameId} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-baseline justify-between gap-4">
                        <p className="truncate text-sm font-medium">{game.displayName}</p>
                        <p className="shrink-0 text-sm tabular-nums">{exactMoney(game.ipRoyaltyShare)}</p>
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                        </div>
                        <span className="w-20 shrink-0 text-right text-[10px] text-muted-foreground">
                          {game.kioskCount} kiosks
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>
        </div>
      </div>

      <Panel
        title="Settlement history"
        subtitle="Monthly statements, net of GST and payment-gateway fees"
        action={<span className="text-xs text-muted-foreground">{statements.length} statements</span>}
      >
        {statements.length === 0 ? (
          <EmptyState
            icon={<ReceiptText size={18} />}
            message="No monthly settlement has been generated yet. Statements appear after the daily pipeline completes a month."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Statement</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Titles</th>
                  <th className="px-3 py-2 font-medium">Kiosks</th>
                  <th className="px-3 py-2 font-medium">Payout</th>
                  <th className="px-3 py-2 font-medium">PDF</th>
                </tr>
              </thead>
              <tbody>
                {statements.map(settlement => (
                  <tr key={settlement.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-3 font-medium">
                      {MONTHS[settlement.month - 1] ?? settlement.month} {settlement.year}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide ${
                          settlement.status.toUpperCase() === "PAID"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {settlement.status.toLowerCase()}
                      </span>
                    </td>
                    <td className="px-3 py-3 tabular-nums text-muted-foreground">{settlement.linesCount ?? 0}</td>
                    <td className="px-3 py-3 tabular-nums text-muted-foreground">{settlement.totalKioskCount}</td>
                    <td className="px-3 py-3 tabular-nums">{exactMoney(settlement.finalPayout)}</td>
                    <td className="px-3 py-3">
                      {settlement.hasPdf ? (
                        <button
                          type="button"
                          onClick={() => void downloadSettlement(settlement)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
                        >
                          <Download size={13} /> Download
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="text-xs text-muted-foreground">
        Royalty is calculated on the Company share of net revenue (after GST and payment-gateway fees), per
        transaction. Settlements run monthly after the daily pipeline completes.
      </p>

      {selectedGame && <IpPartyGameKiosksModal game={selectedGame} onClose={() => setSelectedGame(null)} />}
    </div>
  )
}
