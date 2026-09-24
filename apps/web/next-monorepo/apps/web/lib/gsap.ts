"use client"

import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"

// Register once (client only). Safe to call repeatedly.
if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger)
}

export { gsap, ScrollTrigger }

/** Respect the user's OS-level reduced-motion preference. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/** Shared easing/duration so motion feels like one system. */
export const EASE = "power3.out"
export const DUR = 0.55
