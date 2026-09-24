"use client"
import React, { useRef, useEffect } from "react"
import { gsap } from "gsap"
import { cn } from "@workspace/ui/lib/utils"

interface BlurTextProps {
  text: string
  delay?: number
  className?: string
}

export function BlurText({ text, delay = 0, className }: BlurTextProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const words = text.split(" ")

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const chars = el.querySelectorAll(".blur-word")
    
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (prefersReducedMotion) {
      gsap.set(chars, { opacity: 1, filter: "blur(0px)", y: 0 })
      return
    }

    gsap.fromTo(
      chars,
      { opacity: 0, filter: "blur(10px)", y: 10 },
      {
        opacity: 1,
        filter: "blur(0px)",
        y: 0,
        duration: 0.8,
        stagger: 0.05,
        delay,
        ease: "power2.out",
      }
    )
  }, [text, delay])

  return (
    <div ref={containerRef} className={cn("inline-flex flex-wrap gap-x-1.5", className)}>
      {words.map((word, i) => (
        <span key={i} className="blur-word inline-block opacity-0">
          {word}
        </span>
      ))}
    </div>
  )
}
