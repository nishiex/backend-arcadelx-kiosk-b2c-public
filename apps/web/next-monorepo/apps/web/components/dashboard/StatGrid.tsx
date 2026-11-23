"use client"

import React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Box,
  CheckCircle2,
  Users,
  ClipboardList,
  MapPin,
  Megaphone,
} from "lucide-react"
import {
  fetchInventorySummary,
  fetchPendingMembers,
  fetchOrders,
} from "@/lib/backend-api"
import { fetchMothershipAds } from "@/lib/mothership-ads-api"
import { fetchBannerAds } from "@/lib/mothership-banner-ads-api"
import { useMe } from "@/hooks/useMe"
import { useReveal } from "@/hooks/useReveal"
import StatCard from "./StatCard"
import { Skeleton, ErrorState } from "./ui"

// Indian digit grouping (1,00,000) to match the currency formatting used across the app;
// en-US grouped the same numbers differently from every INR figure beside them.
const nf = new Intl.NumberFormat("en-IN")

export default function StatGrid() {
  const { canManageMembers, canViewAds, orgType } = useMe()

  const inventory = useQuery({
    queryKey: ["inventorySummary"],
    queryFn: fetchInventorySummary,
  })
  const members = useQuery({
    queryKey: ["pendingMembers", 1, 1],
    queryFn: () => fetchPendingMembers(1, 1),
    enabled: canManageMembers,
  })
  const orders = useQuery({
    queryKey: ["dashboardOrders", "UNDER_REVIEW"],
    queryFn: ({ signal }) => fetchOrders("UNDER_REVIEW", signal),
  })
  const ads = useQuery({
    queryKey: ["mothership-ads"],
    queryFn: ({ signal }) => fetchMothershipAds(signal),
    enabled: canViewAds,
    refetchInterval: 15_000,
  })
  const bannerAds = useQuery({
    queryKey: ["banner-ads"],
    queryFn: ({ signal }) => fetchBannerAds(signal),
    enabled: canViewAds,
    refetchInterval: 15_000,
  })

  const summary = inventory.data?.summary ?? {}
  const total = inventory.data?.total ?? Object.values(summary).reduce((a, b) => a + (b || 0), 0)
  // The headline card counts hardware that Mothership knows about. Registered machine codes
  // with no device behind them are reported separately — the card used to add them together
  // and show 206 against a 106-device fleet.
  const paired = inventory.data?.paired ?? total
  const unpaired = inventory.data?.unpaired ?? Math.max(0, total - paired)
  const installed = summary["INSTALLED"] || 0
  const available = summary["AVAILABLE"] || 0

  const share = (n: number) => (total > 0 ? (n / total) * 100 : 0)

  type Card = {
    label: string
    value: number
    icon: React.ReactNode
    hint?: string
    iconClass?: string
    accent?: string
    pct?: number
  }

  const cards: Card[] = [
    {
      label: "Paired Kiosks",
      value: paired,
      icon: <Box size={18} />,
      iconClass: "bg-primary/10 text-primary",
      // A Distributor's total spans its own inventory plus the machines its Partners run.
      hint:
        unpaired > 0
          ? `${nf.format(total)} registered · ${nf.format(unpaired)} without hardware`
          : orgType === "DISTRIBUTOR"
            ? "Own inventory and Partner machines"
            : "Across your inventory",
    },
    { label: "Available", value: available, icon: <MapPin size={18} />, iconClass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", accent: "bg-emerald-500", pct: share(available) },
    { label: "Installed", value: installed, icon: <CheckCircle2 size={18} />, iconClass: "bg-violet-500/10 text-violet-600 dark:text-violet-400", accent: "bg-violet-500", pct: share(installed) },
  ]

  if (canManageMembers) {
    cards.push({
      label: "Pending Members",
      value: members.data?.meta?.total ?? 0,
      icon: <Users size={18} />,
      iconClass: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
      hint: "Awaiting approval",
    })
  }
  {
    cards.push({
      label: "Orders & Requests",
      value: orders.data?.length ?? 0,
      icon: <ClipboardList size={18} />,
      iconClass: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
      hint: "Awaiting review",
    })
  }
  if (canViewAds) {
    cards.push({
      label: "Ads",
      value: ads.data?.ads.length ?? 0,
      icon: <Megaphone size={18} />,
      iconClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      hint: "Regular Ads library",
    })
    cards.push({
      label: "Banner Ads",
      value: bannerAds.data?.ads.length ?? 0,
      icon: <Megaphone size={18} />,
      iconClass: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
      hint: "Banner Ads library",
    })
  }

  const ref = useReveal<HTMLDivElement>([inventory.isSuccess, cards.length])

  if (inventory.isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-2 sm:grid-cols-3 md:grid-cols-2 xl:grid-cols-6 2xl:grid-cols-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[112px]" />
        ))}
      </div>
    )
  }

  if (inventory.isError) {
    return (
      <div className="rounded-xl border border-border bg-card">
        <ErrorState message="Couldn't load inventory metrics." onRetry={() => inventory.refetch()} />
      </div>
    )
  }

  return (
    <div
      ref={ref}
      className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-2 sm:grid-cols-3 md:grid-cols-2 xl:grid-cols-7  2xl:grid-cols-7"
    >
      {cards.map((c) => (
        <StatCard
          key={c.label}
          label={c.label}
          value={c.value}
          icon={c.icon}
          hint={c.hint}
          iconClass={c.iconClass}
          accent={c.accent}
          pct={c.pct}
          format={(n) => nf.format(Math.round(n))}
        />
      ))}
    </div>
  )
}
