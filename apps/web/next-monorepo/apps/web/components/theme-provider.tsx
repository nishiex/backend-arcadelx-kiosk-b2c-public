"use client"

import * as React from "react"

type Theme = "light" | "dark" | "system"

const STORAGE_KEY = "theme"

function resolveSystemTheme() {
  if (typeof window === "undefined") return "light"
  try {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  } catch (e) {
    return "light"
  }
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  let resolved = theme
  if (theme === "system") resolved = resolveSystemTheme()
  if (resolved === "dark") root.classList.add("dark")
  else root.classList.remove("dark")
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch (e) {
    // ignore
  }
  // set color-scheme for better form controls
  root.style.colorScheme = resolved === "dark" ? "dark" : "light"
}

const ThemeContext = React.createContext<{ theme: Theme; setTheme: (t: Theme) => void } | undefined>(undefined)

export function useTheme() {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider")
  return ctx
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = React.useState<Theme>(() => {
    if (typeof window === "undefined") return "light"
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
      return (stored as Theme) || "system"
    } catch (e) {
      return "system"
    }
  })

  React.useEffect(() => {
    applyTheme(theme)
  }, [theme])

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (!event.key || event.key.toLowerCase() !== "d") return
      // Don't hijack the shortcut while the user is typing in a field.
      const t = event.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      const resolved = theme === "dark" ? "light" : "dark"
      setThemeState(resolved)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [theme])

  const setTheme = React.useCallback((t: Theme) => {
    setThemeState(t)
  }, [])

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
}

export default ThemeProvider
