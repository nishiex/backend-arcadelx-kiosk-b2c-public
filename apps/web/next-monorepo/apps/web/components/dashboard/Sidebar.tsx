"use client"

import React, { Suspense, useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import {
  LayoutGrid,
  UserCog,
  UsersRound,
  MonitorSmartphone,
  Building2,
  ClipboardList,
  Cpu,
  IndianRupee,
  Activity,
  CreditCard,
  Settings,
  Menu,
  X,
  ChevronDown,
  Share2,
  ScrollText,
  Waypoints,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { useMe } from "@/hooks/useMe"
import { gsap, prefersReducedMotion, EASE } from "@/lib/gsap"

type Perms = ReturnType<typeof useMe>

type NavItem = {
  name: string
  href: string
  icon: LucideIcon
  /** When false, the item is hidden for the current user. */
  show?: (p: Perms) => boolean
  /**
   * Section of a shared page this link opens. `/requests` renders two sections
   * (network connections and agreements) from one route, so the sidebar needs the
   * query parameter to know which one is current.
   */
  tab?: string
}

type NavEntry = { kind: "link"; item: NavItem } | { kind: "network" }

// Only destinations backed by a live API on this deployment are listed.
const NAV: NavEntry[] = [
  { kind: "link", item: { name: "Overview", href: "/", icon: LayoutGrid } },
  { kind: "link", item: { name: "Kiosks", href: "/kiosks", icon: MonitorSmartphone } },
  // Hardware as Mothership reports it. Read scope matches revenue; the price write inside
  // is COMPANY OWNER/ADMIN only.
  { kind: "link", item: { name: "Devices", href: "/devices", icon: Cpu, show: (p) => p.canViewDevices } },
  {
    kind: "link",
    item: {
      name: "Orders",
      href: "/orders",
      icon: ClipboardList,
      show: (p) =>
        p.canTransact ||
        (p.orgType === "PARTNER" &&
          p.me?.membership?.status === "ACTIVE" &&
          (p.role === "OWNER" || p.role === "ADMIN")),
    },
  },
  { kind: "link", item: { name: "Revenue", href: "/revenue", icon: IndianRupee, show: (p) => p.canViewRevenue } },
  { kind: "link", item: { name: "Analytics", href: "/analytics", icon: Activity, show: (p) => p.canViewAnalytics } },
  { kind: "link", item: { name: "Gateways", href: "/gateways", icon: CreditCard, show: (p) => p.canManageGateways } },
  // The Distributors section: the row itself is the distributor list, and it expands
  // into separate Network, Agreements and Partners entries. Agreements stays here;
  // it is intentionally not a second tab on the Requests page.
  { kind: "network" },
  { kind: "link", item: { name: "Users", href: "/user", icon: UserCog, show: (p) => p.canManageMembers } },
  { kind: "link", item: { name: "Audit Logs", href: "/audit-logs", icon: ScrollText, show: (p) => p.canManageMembers } },
  { kind: "link", item: { name: "Settings", href: "/settings", icon: Settings } },
]

const NETWORK_CHILDREN: NavItem[] = [
  { name: "Networks", href: "/requests", icon: Share2, show: (p) => p.canReviewRequests },
  // Active Owners/Admins of every organization type, including Partners, must
  // be able to review incoming financial agreements.
  { name: "Agreements", href: "/agreements", icon: ScrollText, show: (p) => p.canReviewRequests },
  { name: "Partners", href: "/partners", icon: UsersRound, show: (p) => p.canViewPartners || p.canManageDistributors },
]

function isActive(item: NavItem, pathname: string, tab: string | null) {
  if (item.href === "/requests") {
    // Network is the only view on this route. Agreements has its own route now.
    return pathname === item.href && (item.tab ? tab === item.tab : true)
  }
  if (item.href === "/") return pathname === "/"
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

function NavLink({
  item,
  active,
  nested,
  onNavigate,
}: {
  item: NavItem
  active: boolean
  nested?: boolean
  onNavigate?: () => void
}) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg text-sm font-medium transition-colors",
        nested ? "py-2 pl-3 pr-3" : "px-3 py-2.5",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
      )}
    >
      <Icon size={nested ? 16 : 18} className="shrink-0" />
      <span>{item.name}</span>
    </Link>
  )
}

/**
 * The Distributors dropdown.
 *
 * For a COMPANY the row is the existing Distributors page plus a chevron that expands
 * the section's other lists -- the dropdown the client asked for sits on Distributors
 * itself, not on a separate parent item. For a DISTRIBUTOR or PARTNER the row is a
 * plain toggle labelled Network (the Distributors page is COMPANY-only), giving the
 * same three lists a home.
 *
 * A disclosure (chevron button + panel) rather than a menu widget: the children are
 * ordinary links, so they keep native keyboard and screen-reader behaviour. GSAP owns
 * the height/opacity/chevron transition, and the panel is `inert` while collapsed so a
 * zero-height panel can never be reached by Tab.
 */
function NavNetworkSection({
  paths,
  onNavigate,
  perms,
}: {
  paths: { pathname: string; tab: string | null }
  onNavigate?: () => void
  perms: Perms
}) {
  const items = NETWORK_CHILDREN.filter((i) => (i.show ? i.show(perms) : true))
  const activeItem = items.find((i) => isActive(i, paths.pathname, paths.tab))
  const showParentLink = perms.canManageDistributors
  const parentActive =
    showParentLink &&
    (paths.pathname === "/distributors" || paths.pathname.startsWith("/distributors/"))
  // The section opens itself when the Distributors page or one of its lists is current
  // (deep link, browser back, a link elsewhere in the app). The user's own toggle is an
  // override keyed by that state, so a new route re-opens the section while a manual
  // collapse on the current view still sticks.
  const activeKey = activeItem ? `${activeItem.href}#${activeItem.tab ?? ""}` : parentActive ? "parent" : null
  const [override, setOverride] = useState<{ key: string | null; expanded: boolean } | null>(null)
  const expanded = override && override.key === activeKey ? override.expanded : activeKey !== null
  // Captured once: the panel's inline height is the pre-hydration state and must not be
  // rewritten by React on later renders, or it would fight the GSAP tween.
  const [initiallyExpanded] = useState(activeKey !== null)
  const firstRun = React.useRef(true)
  const toggleRef = React.useRef<HTMLButtonElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const chevronRef = React.useRef<SVGSVGElement>(null)
  const panelId = React.useId()

  function setExpanded(next: boolean) {
    setOverride({ key: activeKey, expanded: next })
  }

  React.useEffect(() => {
    const panel = panelRef.current
    const chevron = chevronRef.current
    if (!panel || !chevron) return

    // The first render already matches `expanded`; animating it would play a transition
    // on page load for a section the user never opened.
    if (firstRun.current) {
      firstRun.current = false
      return
    }

    const reduced = prefersReducedMotion()
    const context = gsap.context(() => {
      gsap.to(chevron, {
        rotation: expanded ? 180 : 0,
        duration: reduced ? 0 : 0.3,
        ease: EASE,
        overwrite: "auto",
      })

      if (expanded) {
        // Start from zero so the panel grows into its measured height instead of jumping.
        gsap.set(panel, { height: 0, opacity: 0 })
        gsap.to(panel, {
          height: "auto",
          opacity: 1,
          duration: reduced ? 0 : 0.34,
          ease: EASE,
          overwrite: "auto",
          // A fixed pixel height would clip children if permissions or labels change later.
          onComplete: () => gsap.set(panel, { height: "auto" }),
        })
        gsap.fromTo(
          panel.querySelectorAll("[data-nav-child]"),
          { y: reduced ? 0 : -6, opacity: 0 },
          {
            y: 0,
            opacity: 1,
            duration: reduced ? 0 : 0.28,
            ease: EASE,
            stagger: reduced ? 0 : 0.04,
            delay: reduced ? 0 : 0.04,
            overwrite: "auto",
          }
        )
      } else {
        gsap.to(panel, {
          height: 0,
          opacity: 0,
          duration: reduced ? 0 : 0.22,
          ease: "power2.in",
          overwrite: "auto",
        })
      }
    }, panel)

    return () => context.revert()
  }, [expanded])

  if (!showParentLink && !items.length) return null

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && expanded) {
      event.stopPropagation()
      setExpanded(false)
      toggleRef.current?.focus()
      return
    }
    if (event.key === "ArrowDown" && event.target === toggleRef.current) {
      event.preventDefault()
      if (!expanded) {
        setExpanded(true)
        return
      }
      panelRef.current?.querySelector<HTMLElement>("a")?.focus()
      return
    }
    if (event.key === "ArrowUp" && event.target instanceof HTMLAnchorElement) {
      const firstLink = panelRef.current?.querySelector("a")
      if (firstLink && event.target === firstLink) {
        event.preventDefault()
        toggleRef.current?.focus()
      }
    }
  }

  const chevron = (
    <ChevronDown
      ref={chevronRef}
      size={16}
      aria-hidden="true"
      className="shrink-0 origin-center"
      style={{ transform: initiallyExpanded ? "rotate(180deg)" : undefined }}
    />
  )

  return (
    <div onKeyDown={onKeyDown}>
      {showParentLink ? (
        <div
          className={cn(
            "flex items-center rounded-lg transition-colors",
            parentActive
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          )}
        >
          <Link
            href="/distributors"
            onClick={onNavigate}
            aria-current={parentActive ? "page" : undefined}
            className="flex flex-1 items-center gap-3 px-3 py-2.5 text-sm font-medium"
          >
            <Building2 size={18} className="shrink-0" />
            <span>Distributors</span>
          </Link>
          <button
            ref={toggleRef}
            type="button"
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label="Toggle network lists"
            data-state={expanded ? "open" : "closed"}
            onClick={() => setExpanded(!expanded)}
            className="mr-1.5 rounded-md p-1.5 transition-colors hover:bg-foreground/10"
          >
            {chevron}
          </button>
        </div>
      ) : (
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label="Toggle network lists"
          data-state={expanded ? "open" : "closed"}
          onClick={() => setExpanded(!expanded)}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
            activeItem
              ? "text-sidebar-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          )}
        >
          <Waypoints size={18} className="shrink-0" />
          <span>Network</span>
          <span className="ml-auto text-muted-foreground">{chevron}</span>
        </button>
      )}

      <div
        id={panelId}
        ref={panelRef}
        inert={!expanded}
        className="overflow-hidden"
        style={{ height: initiallyExpanded ? "auto" : 0, opacity: initiallyExpanded ? 1 : 0 }}
      >
        <ul className="ml-4 mt-1 space-y-1 border-l border-sidebar-border pl-3">
          {items.map((item) => (
            <li key={`${item.href}-${item.tab ?? "default"}`} data-nav-child>
              <NavLink
                item={item}
                nested
                active={isActive(item, paths.pathname, paths.tab)}
                onNavigate={onNavigate}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function NavList({
  perms,
  onNavigate,
  tab,
}: {
  perms: Perms
  onNavigate?: () => void
  tab: string | null
}) {
  const pathname = usePathname()
  const paths = { pathname, tab }

  return (
    <ul className="space-y-1">
      {NAV.map((entry) => {
        if (entry.kind === "link") {
          if (entry.item.show && !entry.item.show(perms)) return null
          return (
            <li key={entry.item.href}>
              <NavLink item={entry.item} active={isActive(entry.item, pathname, tab)} onNavigate={onNavigate} />
            </li>
          )
        }
        return (
          <li key="network-section">
            <NavNetworkSection paths={paths} perms={perms} onNavigate={onNavigate} />
          </li>
        )
      })}
    </ul>
  )
}

function NavListWithTab({ perms, onNavigate }: { perms: Perms; onNavigate?: () => void }) {
  // `useSearchParams` is URL data, so this component sits inside a Suspense boundary;
  // the rest of the sidebar can still be prerendered.
  const params = useSearchParams()
  return <NavList perms={perms} onNavigate={onNavigate} tab={params?.get("tab") ?? null} />
}

function NavLinks({ perms, onNavigate }: { perms: Perms; onNavigate?: () => void }) {
  return (
    <nav className="flex-1" aria-label="Main">
      <Suspense fallback={<NavList perms={perms} onNavigate={onNavigate} tab={null} />}>
        <NavListWithTab perms={perms} onNavigate={onNavigate} />
      </Suspense>
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
