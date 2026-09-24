"use client"

import React from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchInventorySummary, fetchPendingMembers, InventorySummaryResponse, PendingMembersResponse } from "@/lib/backend-api"

export default function DashboardKPIs() {
  const { data: summaryData, isLoading: loadingSummary, isError: errorSummary } = useQuery<InventorySummaryResponse>({ queryKey: ["inventorySummary"], queryFn: fetchInventorySummary })
  const { data: pendingMembersData, isLoading: loadingMembers } = useQuery<PendingMembersResponse>({ queryKey: ["pendingMembers", 1, 4], queryFn: () => fetchPendingMembers(1, 4) })

  const loading = loadingSummary || loadingMembers

  if (loading) {
    return <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">{Array.from({length:4}).map((_,i)=>(<div key={i} className="bg-card border border-border rounded-md p-4 h-20 animate-pulse"/>))}</div>
  }

  if (errorSummary) {
    return <div className="text-sm text-destructive">Failed to load KPIs</div>
  }

  const summary = summaryData?.summary || {}
  const totalKiosks = Object.values(summary).reduce((a,b)=>a + (b||0), 0)
  const available = summary['AVAILABLE'] || 0
  const installed = summary['INSTALLED'] || 0
  const maintenance = summary['MAINTENANCE'] || 0
  const pendingMembers = pendingMembersData?.meta?.total ?? 0

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <div className="bg-card border border-border rounded-md p-4">
        <div className="text-xs text-muted-foreground">Total Kiosks</div>
        <div className="mt-2 text-2xl font-semibold">{totalKiosks}</div>
      </div>
      <div className="bg-card border border-border rounded-md p-4">
        <div className="text-xs text-muted-foreground">Available</div>
        <div className="mt-2 text-2xl font-semibold">{available}</div>
      </div>
      <div className="bg-card border border-border rounded-md p-4">
        <div className="text-xs text-muted-foreground">Installed</div>
        <div className="mt-2 text-2xl font-semibold">{installed}</div>
      </div>
      <div className="bg-card border border-border rounded-md p-4">
        <div className="text-xs text-muted-foreground">Pending Members</div>
        <div className="mt-2 text-2xl font-semibold">{pendingMembers}</div>
      </div>
    </div>
  )
}
