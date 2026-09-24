"use client"

import React from "react"
import { gsap, ScrollTrigger, prefersReducedMotion, EASE, DUR } from "@/lib/gsap"

/**
 * Reveals a container's direct `[data-reveal]` descendants as they scroll
 * into view. Uses one ScrollTrigger per item, batched under a gsap.context
 * so everything is reverted (and triggers killed) on unmount.
 *
 * No-ops (renders everything visible) under prefers-reduced-motion.
 */
export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(
  deps: React.DependencyList = []
) {
  const ref = React.useRef<T>(null)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const targets = gsap.utils.toArray<HTMLElement>(el.querySelectorAll("[data-reveal]"))
    if (!targets.length) return

    if (prefersReducedMotion()) {
      gsap.set(targets, { opacity: 1, y: 0 })
      return
    }

    const ctx = gsap.context(() => {
      targets.forEach((t) => {
        gsap.fromTo(
          t,
          { opacity: 0, y: 24 },
          {
            opacity: 1,
            y: 0,
            duration: DUR,
            ease: EASE,
            scrollTrigger: {
              trigger: t,
              start: "top 88%",
              once: true,
            },
          }
        )
      })
    }, el)

    // Recalculate positions after layout settles.
    ScrollTrigger.refresh()

    return () => ctx.revert()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return ref
}
