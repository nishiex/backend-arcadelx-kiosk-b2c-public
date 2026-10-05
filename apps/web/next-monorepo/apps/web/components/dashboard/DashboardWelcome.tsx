"use client"

import React from "react"
import { Building2 } from "lucide-react"
import { useMe } from "@/hooks/useMe"
import { gsap, prefersReducedMotion, EASE } from "@/lib/gsap"
import { Skeleton } from "./ui"

function getGreeting(d: Date = new Date()) {
  const h = d.getHours()
  if (h >= 5 && h < 12) return "Good morning"
  if (h >= 12 && h < 17) return "Good afternoon"
  if (h >= 17 && h < 22) return "Good evening"
  return "Good night"
}

/** Live greeting driven by the browser's local clock. */
function useGreeting() {
  const [greeting, setGreeting] = React.useState(() => getGreeting())

  React.useEffect(() => {
    const sync = () =>
      setGreeting((prev) => {
        const next = getGreeting()
        return next === prev ? prev : next
      })

    // Recompute on the client (server timezone may differ), then keep it live.
    sync()
    const id = setInterval(sync, 30_000)
    // Update instantly when the user returns to the tab.
    window.addEventListener("focus", sync)
    document.addEventListener("visibilitychange", sync)
    return () => {
      clearInterval(id)
      window.removeEventListener("focus", sync)
      document.removeEventListener("visibilitychange", sync)
    }
  }, [])

  return greeting
}

// Abstract "fleet mesh": nodes = kiosks, links = network connections.
const NODES = [
  { x: 40, y: 40, r: 4 },
  { x: 110, y: 24, r: 3 },
  { x: 96, y: 92, r: 5 },
  { x: 168, y: 60, r: 3.5 },
  { x: 214, y: 34, r: 3 },
  { x: 236, y: 104, r: 4.5 },
  { x: 150, y: 128, r: 3 },
  { x: 60, y: 120, r: 2.5 },
]
const LINKS: [number, number][] = [
  [0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [3, 5], [2, 6], [5, 6], [2, 7], [6, 7],
]

function FleetVisual() {
  return (
    <svg
      data-hero-visual
      viewBox="0 0 280 160"
      className="pointer-events-none h-[150px] w-[280px] text-primary"
      fill="none"
      aria-hidden
    >
      {LINKS.map(([a, b], i) => (
        <line
          key={i}
          data-link
          x1={NODES[a]!.x}
          y1={NODES[a]!.y}
          x2={NODES[b]!.x}
          y2={NODES[b]!.y}
          stroke="currentColor"
          strokeWidth={1}
          strokeOpacity={0.25}
        />
      ))}
      {NODES.map((n, i) => (
        <g key={i}>
          <circle data-node-halo cx={n.x} cy={n.y} r={n.r + 4} fill="currentColor" opacity={0.08} style={{ transformBox: "fill-box", transformOrigin: "center" }} />
          <circle data-node cx={n.x} cy={n.y} r={n.r} fill="currentColor" opacity={0.85} style={{ transformBox: "fill-box", transformOrigin: "center" }} />
        </g>
      ))}
    </svg>
  )
}

export default function DashboardWelcome() {
  const { me, isLoading, orgName, orgType, role } = useMe()
  const greeting = useGreeting()
  const rootRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (isLoading || !rootRef.current) return
    const root = rootRef.current

    if (prefersReducedMotion()) return

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: EASE } })
      tl.from("[data-hero-bg]", { opacity: 0, duration: 0.6 })
        .from("[data-hero-title]", { opacity: 0, y: 14, duration: 0.5 }, "-=0.35")
        .from("[data-hero-sub]", { opacity: 0, y: 10, duration: 0.45 }, "-=0.3")
        .from("[data-hero-chip]", { opacity: 0, y: 8, scale: 0.96, duration: 0.45 }, "-=0.3")
        .from("[data-hero-visual]", { opacity: 0, duration: 0.6 }, "-=0.5")
        .from("[data-link]", { opacity: 0, duration: 0.5, stagger: 0.04 }, "-=0.4")
        .from("[data-node], [data-node-halo]", { scale: 0, transformOrigin: "center", duration: 0.4, stagger: 0.03, ease: "back.out(2)" }, "-=0.4")

      // Gentle looping ambience (transforms/opacity only).
      gsap.to("[data-node-halo]", {
        scale: 1.35,
        transformOrigin: "center",
        opacity: 0.14,
        duration: 2.2,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
        stagger: { each: 0.25, from: "random" },
      })
      gsap.to("[data-link]", {
        strokeOpacity: 0.5,
        duration: 2.6,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
        stagger: { each: 0.2, from: "random" },
      })
    }, root)

    return () => ctx.revert()
  }, [isLoading])

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-3 h-4 w-48" />
        <Skeleton className="mt-5 h-9 w-56 rounded-full" />
      </div>
    )
  }

  const firstName = me?.name?.split(" ")[0] ?? "there"
  // Display branding only; COMPANY/OWNER remain the authoritative API values.
  const isMasterAdmin = orgType === "COMPANY" && role === "OWNER" && me?.membership?.status === "ACTIVE"

  return (
    <div
      ref={rootRef}
      className="relative isolate overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-8"
    >
      {/* Layered background: soft radial glow + faint grid, both very subtle. */}
      <div data-hero-bg className="pointer-events-none absolute inset-0 -z-10">
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
          <h1 data-hero-title className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {greeting}, {firstName}
          </h1>
          <p data-hero-sub className="mt-1.5 max-w-md text-sm text-muted-foreground">
            Here's what's happening across your kiosk network today.
          </p>

          {orgName && (
            <div
              data-hero-chip
              className="mt-5 inline-flex items-center gap-2.5 rounded-full border border-border bg-background/60 py-1.5 pl-1.5 pr-4 backdrop-blur"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Building2 size={15} />
              </span>
              <span className="leading-tight">
                <span className="block text-sm font-medium">{isMasterAdmin ? "ArcadeLX" : orgName}</span>
                <span className="block text-[11px] tracking-wide text-muted-foreground">
                  {isMasterAdmin ? "Master Admin" : `${orgType ?? ""}${role ? ` · ${role}` : ""}`}
                </span>
              </span>
            </div>
          )}
        </div>

        {/* Fleet/network visual (decorative, hidden on small screens). */}
        <div className="hidden shrink-0 self-stretch sm:flex sm:items-center sm:justify-end">
          <FleetVisual />
        </div>
      </div>
    </div>
  )
}
