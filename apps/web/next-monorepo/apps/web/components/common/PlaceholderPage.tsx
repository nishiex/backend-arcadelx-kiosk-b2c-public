"use client"

import React from "react"
import { gsap, prefersReducedMotion, EASE } from "@/lib/gsap"

/**
 * Honest placeholder for sections that don't have a backend yet.
 * No mock data — just a clear, on-brand "coming soon" panel.
 */
export default function PlaceholderPage({
  title,
  description,
  icon,
  note,
}: {
  title: string
  description: string
  icon: React.ReactNode
  note?: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!ref.current || prefersReducedMotion()) return
    const ctx = gsap.context(() => {
      gsap.from(ref.current!.querySelectorAll("[data-reveal]"), {
        opacity: 0,
        y: 12,
        duration: 0.5,
        ease: EASE,
        stagger: 0.08,
      })
    }, ref)
    return () => ctx.revert()
  }, [])

  return (
    <div ref={ref} className="mx-auto max-w-7xl space-y-6">
      <div data-reveal>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>

      <div
        data-reveal
        className="relative isolate flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-border bg-card px-6 py-20 text-center"
      >
        {/* soft grid backdrop */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 opacity-[0.04] [mask-image:radial-gradient(circle_at_center,black,transparent_75%)]"
          style={{
            backgroundImage:
              "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
            backgroundSize: "26px 26px",
          }}
        />
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          {icon}
        </span>
        <h2 className="mt-5 text-lg font-semibold">Coming soon</h2>
        <p className="mt-1.5 max-w-md text-sm text-muted-foreground">
          {note ??
            "This module isn't available yet. It will appear here once the backend for it is in place — no placeholder data is shown in the meantime."}
        </p>
      </div>
    </div>
  )
}
