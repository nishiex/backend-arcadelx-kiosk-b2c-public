"use client"

import React from "react"
import { Sun, Moon } from "lucide-react"
import { useTheme } from "@/components/theme-provider"

// Visible companion to the existing "d" keyboard shortcut. Derives the active
// theme from the ThemeProvider state (resolving "system" via matchMedia) rather
// than reading the DOM class — the class is applied by a parent effect that runs
// AFTER this child's effects, so reading it here lagged a step and left the
// toggle stuck in dark mode.
export default function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  const [systemDark, setSystemDark] = React.useState(false)

  // Track the OS preference so "system" resolves correctly, and defer the icon
  // until mount to avoid an SSR/client mismatch.
  React.useEffect(() => {
    setMounted(true)
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    setSystemDark(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  const isDark = theme === "dark" || (theme === "system" && systemDark)

  // Drive BOTH the icon and the aria-label off the same mount-gated value so the
  // server render and the first client render agree (avoids a hydration mismatch
  // on the label); the real theme is reflected once effects run post-mount.
  const showDark = mounted && isDark

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={showDark ? "Switch to light mode" : "Switch to dark mode"}
      title="Toggle theme (d)"
      className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {showDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  )
}
