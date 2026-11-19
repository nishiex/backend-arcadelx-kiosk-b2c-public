"use client"

import React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { LogOut } from "lucide-react"
import { logout } from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"

const NAV = [
  { href: "#royalty", label: "Royalty" },
  { href: "#games", label: "Catalogue" },
  { href: "#royalties", label: "By title" },
  { href: "#settlements", label: "Settlements" },
]

// IP owners get their own surface rather than the operator console: a dark,
// editorial studio with a top bar instead of the admin sidebar. The `dark` class
// scopes the design tokens so shared primitives (skeletons, dialogs) stay legible
// on the ink canvas.
export default function IpStudioShell({ children }: { children: React.ReactNode }) {
  const { me, role, orgName } = useMe()
  const queryClient = useQueryClient()
  const [signingOut, setSigningOut] = React.useState(false)

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await queryClient.cancelQueries()
      await logout()
      queryClient.clear()
      window.location.replace("/login")
    } catch {
      toast.error("Couldn't sign out. Please try again.")
      setSigningOut(false)
    }
  }

  return (
    <div className="dark min-h-dvh bg-[#0b1220] text-white">
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#0b1220]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden className="h-7 w-7 shrink-0 rounded-lg bg-gradient-to-br from-blue-400 to-indigo-500" />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-white">
                ArcadeLX <span className="font-normal text-white/35">Studio</span>
              </p>
              <p className="truncate font-mono text-[10px] uppercase tracking-[0.22em] text-white/30">
                {orgName ?? "IP owner"}
              </p>
            </div>
          </div>

          <nav aria-label="Studio sections" className="hidden items-center gap-7 md:flex">
            {NAV.map(item => (
              <a
                key={item.href}
                href={item.href}
                className="text-xs text-white/45 transition hover:text-white"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="max-w-40 truncate text-xs text-white/80">{me?.name ?? "IP owner"}</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/30">{role ?? "owner"}</p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={signingOut}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/60 transition hover:bg-white/5 hover:text-white disabled:opacity-50"
            >
              <LogOut size={13} /> {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  )
}
