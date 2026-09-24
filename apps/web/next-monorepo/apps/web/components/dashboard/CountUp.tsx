"use client"

import React from "react"
import { gsap, prefersReducedMotion } from "@/lib/gsap"

type Props = {
  value: number
  className?: string
  /** Format the animated number (e.g. thousands separators). */
  format?: (n: number) => string
  duration?: number
}

/**
 * Tweens from the previous value to the new one with GSAP. The displayed
 * text is React state (not imperative textContent), so re-renders from
 * sibling queries resolving can't reset it mid-animation.
 */
export default function CountUp({ value, className, format, duration = 1 }: Props) {
  const fmt = React.useCallback(
    (n: number) => (format ? format(n) : String(Math.round(n))),
    [format]
  )
  const [display, setDisplay] = React.useState(() => fmt(0))
  const prev = React.useRef(0)

  React.useEffect(() => {
    if (prefersReducedMotion()) {
      setDisplay(fmt(value))
      prev.current = value
      return
    }
    const obj = { n: prev.current }
    const tween = gsap.to(obj, {
      n: value,
      duration,
      ease: "power2.out",
      onUpdate: () => setDisplay(fmt(obj.n)),
    })
    prev.current = value
    return () => {
      tween.kill()
    }
  }, [value, duration, fmt])

  return (
    <span className={className} suppressHydrationWarning>
      {display}
    </span>
  )
}
