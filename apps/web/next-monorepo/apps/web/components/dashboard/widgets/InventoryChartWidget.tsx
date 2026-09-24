"use client"

import React from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchInventorySummary, InventorySummaryResponse } from "@/lib/backend-api"
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts"

export default function InventoryChartWidget() {
  const { data, isLoading, isError } = useQuery<InventorySummaryResponse>({ queryKey: ["inventorySummary"], queryFn: fetchInventorySummary })

  if (isLoading) return <div className="h-64 flex items-center justify-center">Loading...</div>
  if (isError) return <div className="h-64 flex items-center justify-center text-sm text-destructive">Failed to load inventory chart</div>

  const summary = data?.summary || {}
  const series = Object.keys(summary).map((k) => ({ status: k, count: summary[k] }))

  if (!series.length) return <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">No inventory data</div>

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={series}>
          <XAxis dataKey="status" />
          <YAxis />
          <Tooltip />
          <Bar dataKey="count" fill="#3b82f6" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
