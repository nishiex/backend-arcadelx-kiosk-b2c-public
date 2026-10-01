"use client"

import React, { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutGrid,
  UserCog,
  MonitorSmartphone,
  Building2,
  ClipboardList,
  Settings,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { useMe } from "@/hooks/useMe"

type NavItem = {
  name: string
  href: string
  icon: LucideIcon
  /** When false, the item is hidden for the current user. */
  show?: (p: ReturnType<typeof useMe>) => boolean
}

// Only destinations backed by a live API on this deployment are listed.
// (Revenue, Settlements, Payments, Reports, Support, Roles and Audit
// Logs are hidden until their endpoints exist.)
const NAV: NavItem[] = [
  { name: "Overview", href: "/", icon: LayoutGrid },
  { name: "Kiosks", href: "/kiosks", icon: MonitorSmartphone },
  { name: "Orders", href: "/orders", icon: ClipboardList, show: (p) => p.canTransact },
  { name: "Distributors", href: "/distributors", icon: Building2, show: (p) => p.canManageDistributors },
  { name: "Users", href: "/user", icon: UserCog, show: (p) => p.canManageMembers },
  { name: "Settings", href: "/settings", icon: Settings },
]

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const perms = useMe()
  const items = NAV.filter((i) => (i.show ? i.show(perms) : true))

  return (
    <nav className="flex-1 space-y-1">
      {items.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            )}
          >
            <Icon size={18} className="shrink-0" />
            <span>{item.name}</span>
          </Link>
        )
      })}
    </nav>
  )
}

function Brand() {
  return (
    <div className="mb-6 flex items-center gap-2 px-1">
      <img src="/logo.png" alt="ArcadeLX" className="h-8 w-8 rounded-lg object-contain" />
      <span className="text-lg font-bold tracking-tight">ArcadeLX</span>
    </div>
  )
}

export default function Sidebar() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col self-start overflow-y-auto border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <Brand />
        <NavLinks />
        <div className="mt-4 px-1 text-xs text-muted-foreground">v1.0.0</div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-sidebar-border bg-sidebar p-3 md:hidden">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="ArcadeLX" className="h-7 w-7 rounded-md object-contain" />
          <span className="font-bold">ArcadeLX</span>
        </div>
        <button
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="rounded-md p-1.5 hover:bg-muted"
        >
          <Menu size={20} />
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute bottom-0 left-0 top-0 flex w-72 flex-col border-r border-sidebar-border bg-sidebar p-4">
            <div className="mb-6 flex items-center justify-between">
              <Brand />
              <button
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 hover:bg-muted"
              >
                <X size={18} />
              </button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  )
}
