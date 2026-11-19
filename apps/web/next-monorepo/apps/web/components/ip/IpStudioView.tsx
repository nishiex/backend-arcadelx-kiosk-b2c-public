"use client"

import React from "react"
import dynamic from "next/dynamic"
import { useGSAP } from "@gsap/react"
import { ArrowUpRight, Download, Monitor, Sparkles } from "lucide-react"
import CountUp from "@/components/dashboard/CountUp"
import { useReveal } from "@/hooks/useReveal"
import { gsap, prefersReducedMotion } from "@/lib/gsap"
import type { IpDailyRevenue, IpGame, IpSettlement } from "@/lib/ip-api"

// WebGL is heavy and SSR-hostile, so the hero scene loads client-side after this
// component mounts, with the aurora gradient standing in until then.
const IpHeroCanvas = dynamic(() => import("./IpHeroCanvas"), { ssr: false })

const money = (value: unknown) =>
  `₹${Number(value ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const money0 = (value: unknown) => `₹${Number(value ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// Literal class strings so Tailwind can see them; one wash per catalogue position.
const COVER_GRADIENTS = [
  "from-blue-500 via-indigo-700 to-slate-950",
  "from-indigo-400 via-blue-700 to-slate-950",
  "from-violet-500 via-indigo-700 to-slate-950",
  "from-sky-500 via-blue-800 to-slate-950",
]

export type IpStudioProps = {
  games: IpGame[]
  daily: IpDailyRevenue
  settlements: IpSettlement[]
  onOpenKiosks: (game: IpGame) => void
  onDownloadSettlement: (settlement: IpSettlement) => void
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div data-reveal>
      <dt className="text-[10px] uppercase tracking-[0.22em] text-white/35">{label}</dt>
      <dd className="mt-1 font-heading text-lg font-semibold tabular-nums text-white/90">{value}</dd>
    </div>
  )
}

export function IpStudioLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading studio">
      <div className="h-64 animate-pulse rounded-3xl border border-white/10 bg-white/[0.03]" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map(index => (
          <div key={index} className="h-44 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03]" />
        ))}
      </div>
      <div className="h-56 animate-pulse rounded-2xl border border-white/10 bg-white/[0.02]" />
    </div>
  )
}

export function IpStudioError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-rose-400/20 bg-rose-500/5 p-8 text-center">
      <p className="text-sm text-rose-200">Couldn&apos;t load your studio.</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-lg border border-white/15 px-4 py-2 text-xs text-white/70 hover:bg-white/5 hover:text-white"
      >
        Try again
      </button>
    </div>
  )
}

export default function IpStudioView({ games, daily, settlements, onOpenKiosks, onDownloadSettlement }: IpStudioProps) {
  const scope = React.useRef<HTMLDivElement>(null)
  const heroRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLDivElement>(null)
  const [showCanvas, setShowCanvas] = React.useState(false)
  // Read once; the canvas only mounts after the timeout below, so there is no
  // hydration mismatch even though this initializer differs between SSR and client.
  const [reducedMotion] = React.useState(() => (typeof window === "undefined" ? false : prefersReducedMotion()))

  const summary = daily.summary
  const gross = Number(summary.totalGrossRevenue ?? 0)
  const royalty = Number(summary.totalIpRoyaltyShare ?? 0)
  const royaltyRate = gross > 0 ? Math.round((royalty / gross) * 100) : 0
  const maxGross = Math.max(...daily.games.map(game => Number(game.grossRevenue)), 0)

  useReveal([daily.businessDate, games.length, settlements.length])

  // Reduced motion and a deferred canvas mount are client-only facts, so they are
  // read after hydration: SSR renders the static fallback either way.
  React.useEffect(() => {
    const idle = window.setTimeout(() => setShowCanvas(true), 350)
    return () => window.clearTimeout(idle)
  }, [])

  // Hero motion: a soft pointer parallax on the 3D layer plus one entrance
  // timeline for the headline. Both are scoped and reverted by useGSAP, and the
  // whole block no-ops under prefers-reduced-motion.
  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      const canvas = canvasRef.current
      if (canvas) {
        const tiltY = gsap.quickTo(canvas, "y", { duration: 0.6, ease: "power2.out" })
        const tiltX = gsap.quickTo(canvas, "x", { duration: 0.6, ease: "power2.out" })
        const onMove = (event: PointerEvent) => {
          const bounds = canvas.getBoundingClientRect()
          tiltX(((event.clientX - bounds.left) / bounds.width - 0.5) * 18)
          tiltY(((event.clientY - bounds.top) / bounds.height - 0.5) * -14)
        }
        window.addEventListener("pointermove", onMove, { passive: true })
        return () => window.removeEventListener("pointermove", onMove)
      }
    },
    { scope, dependencies: [showCanvas] }
  )

  useGSAP(
    () => {
      if (prefersReducedMotion()) return
      gsap.fromTo(
        "[data-hero-line]",
        { opacity: 0, y: 22 },
        { opacity: 1, y: 0, duration: 0.7, ease: "power3.out", stagger: 0.09 }
      )
    },
    { scope, dependencies: [daily.businessDate] }
  )

  return (
    <div ref={scope} className="relative">
      {/* Aurora wash — decorative only. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[520px] overflow-hidden">
        <div className="absolute left-1/4 h-[420px] w-[520px] -translate-x-1/2 rounded-full bg-blue-600/25 blur-[130px]" />
        <div className="absolute right-0 h-[360px] w-[440px] rounded-full bg-indigo-500/20 blur-[120px]" />
      </div>

      <section
        id="royalty"
        ref={heroRef}
        className="relative grid gap-6 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-10 lg:grid-cols-[1.25fr_1fr] lg:items-center"
      >
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-400/60 to-transparent" />

        <div>
          <p data-hero-line className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-white/40">
            <Sparkles size={12} className="text-blue-300" /> Royalty earned
          </p>
          <p data-hero-line className="mt-4 bg-gradient-to-r from-white via-blue-100 to-indigo-200 bg-clip-text font-heading text-5xl font-semibold tracking-tight text-transparent sm:text-6xl">
            <CountUp value={royalty} format={money0} />
          </p>
          <p data-hero-line className="mt-3 font-mono text-[11px] text-white/35">
            {daily.businessDate} · {daily.aggregationStatus.toLowerCase().replaceAll("_", " ")}
          </p>
        </div>

        {/* 3D layer: mounted after first paint so it never blocks the numbers. */}
        <div
          ref={canvasRef}
          data-hero-line
          className="relative h-[240px] sm:h-[280px]"
          role="img"
          aria-label="Rotating visual of kiosk screens orbiting a glowing core"
        >
          <div aria-hidden className="absolute inset-0 rounded-full bg-blue-500/10 blur-[70px]" />
          {showCanvas ? (
            <IpHeroCanvas reducedMotion={reducedMotion} />
          ) : (
            <div aria-hidden className="absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_50%_55%,rgba(52,211,153,0.22),transparent_62%)]" />
          )}
        </div>

        <dl className="grid grid-cols-2 gap-8 sm:grid-cols-4 lg:col-span-2 lg:grid-cols-4">
          <Stat label="Gross" value={<CountUp value={gross} format={money0} />} />
          <Stat label="Your share" value={`${royaltyRate}%`} />
          <Stat label="Kiosks" value={<CountUp value={Number(summary.totalKioskCount ?? 0)} />} />
          <Stat label="Titles" value={String(summary.totalGames ?? games.length)} />
        </dl>
      </section>

      <section id="games" className="mt-12">
        <header className="flex items-end justify-between" data-reveal>
          <h2 className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40">Catalogue</h2>
          <span className="font-mono text-[11px] text-white/25">
            {games.length} {games.length === 1 ? "title" : "titles"}
          </span>
        </header>

        {games.length === 0 ? (
          <p data-reveal className="mt-4 rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-white/40">
            No games registered to this studio yet.
          </p>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {games.map((game, index) => (
              <article
                key={game.id}
                data-reveal
                className="group overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition duration-300 hover:-translate-y-1 hover:border-white/25 hover:shadow-[0_24px_60px_-24px_rgba(52,211,153,0.28)]"
              >
                <div className="relative h-36 overflow-hidden">
                  {game.coverImageUrl ? (
                    // Cover art comes from arbitrary hosts, so a plain img keeps next/image config out of this surface.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={game.coverImageUrl}
                      alt=""
                      className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
                    />
                  ) : (
                    <div className={`h-full w-full bg-gradient-to-br ${COVER_GRADIENTS[index % COVER_GRADIENTS.length]}`} />
                  )}
                  <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#0b1220] via-[#0b1220]/20 to-transparent" />
                  <span className="absolute left-3 top-3 rounded-full border border-white/20 bg-black/40 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-white/70">
                    {game.status.toLowerCase()}
                  </span>
                </div>
                <div className="p-4">
                  <p className="truncate text-sm font-medium text-white">{game.displayName}</p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-white/35">{game.gameIdentifier}</p>
                  <button
                    type="button"
                    onClick={() => onOpenKiosks(game)}
                    className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-blue-300/80 transition hover:text-blue-200"
                  >
                    <Monitor size={12} /> View kiosks <ArrowUpRight size={12} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section id="royalties" className="mt-12">
        <header className="flex items-end justify-between" data-reveal>
          <h2 className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40">Royalty by title</h2>
          <span className="font-mono text-[11px] text-white/25">{daily.businessDate}</span>
        </header>

        <div data-reveal className="mt-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5 sm:p-6">
          {daily.games.length === 0 ? (
            <p className="py-6 text-center text-sm text-white/40">No title earned revenue on the latest completed day.</p>
          ) : (
            <div className="divide-y divide-white/5">
              {daily.games.map(game => {
                const share = maxGross > 0 ? Math.max(3, Math.round((Number(game.grossRevenue) / maxGross) * 100)) : 0
                return (
                  <div key={game.gameId} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-4">
                      <p className="truncate text-sm text-white/85">{game.displayName}</p>
                      <p className="shrink-0 font-mono text-[11px] text-white/45">{money(game.ipRoyaltyShare)}</p>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-blue-400 to-indigo-300"
                          style={{ width: `${share}%` }}
                        />
                      </div>
                      <span className="w-20 shrink-0 text-right font-mono text-[10px] text-white/30">
                        {game.kioskCount} kiosks
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <section id="settlements" className="mt-12">
        <header className="flex items-end justify-between" data-reveal>
          <h2 className="font-mono text-[10px] uppercase tracking-[0.3em] text-white/40">Settlement history</h2>
          <span className="font-mono text-[11px] text-white/25">{settlements.length} statements</span>
        </header>

        {settlements.length === 0 ? (
          <p data-reveal className="mt-4 rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-white/40">
            No monthly settlement has been generated yet.
          </p>
        ) : (
          <ol data-reveal className="mt-5 ml-2 border-l border-white/10 pl-6">
            {settlements.map(settlement => (
              <li key={settlement.id} className="relative pb-7 last:pb-0">
                <span
                  aria-hidden
                  className="absolute -left-[31px] top-1.5 h-2.5 w-2.5 rounded-full bg-gradient-to-r from-blue-400 to-indigo-300 ring-4 ring-[#0b1220]"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm text-white/90">
                      {MONTHS[settlement.month - 1] ?? settlement.month} {settlement.year}
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-[11px] text-white/35">
                      <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${settlement.status === "PAID" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-white/15 bg-white/5 text-white/50"}`}>
                        {settlement.status.toLowerCase()}
                      </span>
                      {settlement.linesCount ?? 0} titles · {settlement.totalKioskCount} kiosks
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm text-white/90">{money(settlement.finalPayout)}</p>
                    {settlement.hasPdf && (
                      <button
                        type="button"
                        onClick={() => onDownloadSettlement(settlement)}
                        className="mt-1 inline-flex items-center gap-1 text-[11px] text-blue-300/80 transition hover:text-blue-200"
                      >
                        <Download size={12} /> Download PDF
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
