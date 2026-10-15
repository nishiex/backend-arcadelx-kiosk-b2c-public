"use client"

import React, { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutGrid,
  UserCog,
  UsersRound,
  MonitorSmartphone,
  Building2,
  ClipboardList,
  Inbox,
  Cpu,
  IndianRupee,
  CreditCard,
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
// (Settlements, Payments, Reports, Support, Roles and Audit
// Logs are hidden until their endpoints exist.)
const NAV: NavItem[] = [
  { name: "Overview", href: "/", icon: LayoutGrid },
  { name: "Kiosks", href: "/kiosks", icon: MonitorSmartphone },
  // Hardware as Mothership reports it. Read scope matches revenue; the price write inside
  // is COMPANY OWNER/ADMIN only.
  { name: "Devices", href: "/devices", icon: Cpu, show: (p) => p.canViewDevices },
  { name: "Orders", href: "/orders", icon: ClipboardList, show: (p) => p.canTransact || (p.orgType === "PARTNER" && p.me?.membership?.status === "ACTIVE" && (p.role === "OWNER" || p.role === "ADMIN")) },
  // Incoming connection requests must be approved by their RECEIVER, and the receiver is
  // usually the downstream org. Distributors is COMPANY-only, so for a DISTRIBUTOR or
  // PARTNER this page is the only surface where an incoming request can be accepted --
  // without it they cannot approve anything. A Company does not need it: it reviews per
  // distributor under Distributors → View More, and a Company cannot accept a request it
  // itself initiated (the API matches on receiverOrgId).
  { name: "Requests", href: "/requests", icon: Inbox, show: (p) => p.canReviewRequests && !p.isCompany },
  { name: "Revenue", href: "/revenue", icon: IndianRupee, show: (p) => p.canViewRevenue },
  { name: "Gateways", href: "/gateways", icon: CreditCard, show: (p) => p.canManageGateways },
  { name: "Distributors", href: "/distributors", icon: Building2, show: (p) => p.canManageDistributors },
  { name: "Partners", href: "/partners", icon: UsersRound, show: (p) => p.canViewPartners },
  { name: "Users", href: "/user", icon: UserCog, show: (p) => p.canManageMembers },
  { name: "Settings", href: "/settings", icon: Settings },
]

function NavLinks({ perms, onNavigate }: { perms: ReturnType<typeof useMe>; onNavigate?: () => void }) {
  const pathname = usePathname()
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

const Brand = React.memo(function Brand({ compact = false, accountLabel }: { compact?: boolean; accountLabel: string | null }) {
  return (
    <div className={`flex items-center gap-2 ${compact ? "" : "mb-6 px-1"}`}>
      <img src="/logo.png" alt="ArcadeLX" className="h-8 w-8 rounded-lg object-contain" />
      <div className="leading-tight">
        <span className="block text-lg font-bold tracking-tight">ArcadeLX</span>
        {accountLabel && <span className="mt-0.5 block text-xs font-medium text-muted-foreground">{accountLabel}</span>}
      </div>
    </div>
  )
})

export default function Sidebar() {
  const [open, setOpen] = useState(false)
  // One persistent cache subscription for desktop, mobile branding and drawer.
  const perms = useMe()
  const isMasterAdmin = !perms.isError && perms.isCompany && perms.role === "OWNER" && perms.me?.membership?.status === "ACTIVE"
  const accountLabel = perms.isError || !perms.me ? null
    : perms.orgType === "DISTRIBUTOR" ? "Distributor"
      : perms.orgType === "PARTNER" ? "Partner"
        : isMasterAdmin ? "Master Admin" : null

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col self-start overflow-y-auto border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <Brand accountLabel={accountLabel} />
        <NavLinks perms={perms} />
        <div className="mt-4 px-1 text-xs text-muted-foreground">v1.0.0</div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b border-sidebar-border bg-sidebar p-3 md:hidden">
        <Brand compact accountLabel={accountLabel} />
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
              <Brand accountLabel={accountLabel} />
              <button
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 hover:bg-muted"
              >
                <X size={18} />
              </button>
            </div>
            <NavLinks perms={perms} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
    </>
  )
}
