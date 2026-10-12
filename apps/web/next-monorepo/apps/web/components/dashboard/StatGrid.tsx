"use client"

import React from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Box,
  CheckCircle2,
  Users,
  Network,
  MapPin,
} from "lucide-react"
import {
  fetchInventorySummary,
  fetchPendingMembers,
  fetchNetworkRequests,
} from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"
import { useReveal } from "@/hooks/useReveal"
import StatCard from "./StatCard"
import { Skeleton, ErrorState } from "./ui"

// Indian digit grouping (1,00,000) to match the currency formatting used across the app;
// en-US grouped the same numbers differently from every INR figure beside them.
const nf = new Intl.NumberFormat("en-IN")

export default function StatGrid() {
  const { canManageMembers, canManageNetwork } = useMe()

  const inventory = useQuery({
    queryKey: ["inventorySummary"],
    queryFn: fetchInventorySummary,
  })
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

  const summary = inventory.data?.summary ?? {}
  const total = Object.values(summary).reduce((a, b) => a + (b || 0), 0)
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
    { label: "Total Kiosks", value: total, icon: <Box size={18} />, iconClass: "bg-primary/10 text-primary", hint: "Across your inventory" },
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
  if (canManageNetwork) {
    cards.push({
      label: "Network Requests",
      value: network.data?.meta?.total ?? 0,
      icon: <Network size={18} />,
      iconClass: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
      hint: "Incoming connections",
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
      className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-2 sm:grid-cols-3 md:grid-cols-2 xl:grid-cols-6  2xl:grid-cols-6"
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
