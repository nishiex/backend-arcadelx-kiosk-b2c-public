"use client"

import React from "react"
import { useQuery } from "@tanstack/react-query"
import { Search, Bell, Users, Share2 } from "lucide-react"
import Avatar from "@/components/ui/avatar"
import ThemeToggle from "@/components/dashboard/ThemeToggle"
import { useMe } from "@/hooks/useMe"
import { fetchPendingMembers, fetchNetworkRequests } from "@/lib/backend-api"
import { gsap, prefersReducedMotion } from "@/lib/gsap"

export default function Header() {
  const { me, canManageMembers, canManageNetwork } = useMe()
  const [open, setOpen] = React.useState(false)
  const bellRef = React.useRef<HTMLButtonElement>(null)

  const members = useQuery({
    queryKey: ["pendingMembers", 1, 1],
    queryFn: () => fetchPendingMembers(1, 1),
    enabled: canManageMembers,
  })
  const network = useQuery({
    queryKey: ["networkRequests", 1, 1],
    queryFn: () => fetchNetworkRequests(1, 1),
    enabled: canManageNetwork,
  })

  const memberCount = canManageMembers ? members.data?.meta?.total ?? 0 : 0
  const networkCount = canManageNetwork ? network.data?.meta?.total ?? 0 : 0
  const total = memberCount + networkCount

  // Pop the badge when the count first becomes positive.
  React.useEffect(() => {
    if (total > 0 && bellRef.current && !prefersReducedMotion()) {
      const dot = bellRef.current.querySelector("[data-badge]")
      if (dot) gsap.fromTo(dot, { scale: 0 }, { scale: 1, duration: 0.4, ease: "back.out(2)" })
    }
  }, [total])

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/80 px-6 py-4 backdrop-blur">
      <div className="flex items-center gap-3">
        {/* Brand — logo only on desktop (the sidebar already carries the wordmark). */}
        <a href="/" className="hidden items-center md:flex" aria-label="ArcadeLX home">
          <img src="/logo.png" alt="ArcadeLX" className="h-8 w-8 rounded-lg object-contain" />
        </a>
        <div className="relative hidden sm:block">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Search"
            className="w-56 rounded-lg border border-input bg-card py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            placeholder="Search…"
          />
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-4">
        <ThemeToggle />
        {(canManageMembers || canManageNetwork) && (
          <div className="relative">
            <button
              ref={bellRef}
              onClick={() => setOpen((v) => !v)}
              aria-label={`Notifications${total ? ` (${total})` : ""}`}
              className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Bell size={18} />
              {total > 0 && (
                <span
                  data-badge
                  className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
                >
                  {total}
                </span>
              )}
            </button>

            {open && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-border bg-card p-2 shadow-lg">
                  <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Pending work</p>
                  {total === 0 ? (
                    <p className="px-2 py-3 text-center text-sm text-muted-foreground">You're all caught up 🎉</p>
                  ) : (
                    <ul className="space-y-0.5">
                      {canManageMembers && (
                        <li className="flex items-center justify-between rounded-lg px-2 py-2 text-sm hover:bg-muted">
                          <span className="inline-flex items-center gap-2"><Users size={15} /> Member requests</span>
                          <span className="font-semibold tabular-nums">{memberCount}</span>
                        </li>
                      )}
                      {canManageNetwork && (
                        <li className="flex items-center justify-between rounded-lg px-2 py-2 text-sm hover:bg-muted">
                          <span className="inline-flex items-center gap-2"><Share2 size={15} /> Network requests</span>
                          <span className="font-semibold tabular-nums">{networkCount}</span>
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <Avatar name={me?.name ?? "User"} />
      </div>
    </header>
  )
}
