"use client"

import React from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchRevenueSeries } from "@/lib/dashboard-data"
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"

export default function RevenueWidget() {
  const { data = [], isLoading } = useQuery<{ date: string; value: number }[]>({ queryKey: ["revenueSeries"], queryFn: fetchRevenueSeries })

  return (
    <div className="h-64">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm text-muted-foreground">Revenue</div>
          <div className="text-xl font-semibold">₹ 248,000</div>
        </div>
      </div>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="date" hide />
            <YAxis hide />
            <Tooltip />
            <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
