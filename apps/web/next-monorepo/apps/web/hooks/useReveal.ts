"use client"

import React from "react"
import { gsap, prefersReducedMotion, EASE, DUR } from "@/lib/gsap"

/**
 * Staggered entrance for a container's direct children marked with
 * `data-reveal`. Runs once on mount, scoped via gsap.context so it
 * cleans up automatically. No-ops under prefers-reduced-motion.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(
  deps: React.DependencyList = []
) {
  const ref = React.useRef<T>(null)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const targets = el.querySelectorAll<HTMLElement>("[data-reveal]")
    if (!targets.length) return

    if (prefersReducedMotion()) {
      gsap.set(targets, { opacity: 1, y: 0, clearProps: "all" })
      return
    }

    const ctx = gsap.context(() => {
      gsap.fromTo(
        targets,
        { opacity: 0, y: 16 },
        {
          opacity: 1,
          y: 0,
          duration: DUR,
          ease: EASE,
          stagger: 0.06,
          clearProps: "transform",
        }
      )
    }, el)

    return () => ctx.revert()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return ref
}
