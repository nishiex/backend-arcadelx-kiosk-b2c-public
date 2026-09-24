"use client"
import React, { useRef, useEffect } from "react"
import { gsap } from "gsap"

interface AnimatedNumberProps {
  value: number
  prefix?: string
  suffix?: string
  duration?: number
  className?: string
}

export function AnimatedNumber({ value, prefix = "", suffix = "", duration = 1.5, className }: AnimatedNumberProps) {
  const nodeRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const node = nodeRef.current
    if (!node) return

    const obj = { val: 0 }
    
    // Check for reduced motion
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (prefersReducedMotion) {
       node.textContent = `${prefix}${value.toLocaleString()}${suffix}`
       return
    }

    gsap.to(obj, {
      val: value,
      duration,
      ease: "power2.out",
      onUpdate: () => {
        if (node) {
          node.textContent = `${prefix}${Math.round(obj.val).toLocaleString()}${suffix}`
        }
      },
    })
  }, [value, prefix, suffix, duration])

  return <span ref={nodeRef} className={className}>0</span>
}
