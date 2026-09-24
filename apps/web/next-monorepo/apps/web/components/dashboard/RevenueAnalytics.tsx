"use client"
import React, { useState, useRef, useEffect } from "react"
import { revenueData } from "@/lib/mock-data"
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts"
import { gsap } from "gsap"

export function RevenueAnalytics() {
  const [range, setRange] = useState<"7d" | "30d" | "90d">("30d")
  const data = revenueData[range]
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    gsap.fromTo(containerRef.current, { opacity: 0, scale: 0.98 }, { opacity: 1, scale: 1, duration: 0.8, ease: "power2.out" })
  }, [])

  return (
    <div ref={containerRef} className="col-span-1 md:col-span-2 lg:col-span-3 xl:col-span-3 2xl:col-span-4 border border-border bg-card rounded-xl p-5 flex flex-col">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
          <h2 className="text-lg font-semibold">Revenue Overview</h2>
          <p className="text-sm text-muted-foreground">Current vs previous period</p>
        </div>
        <div className="flex p-1 bg-muted rounded-md border border-border">
          {(["7d", "30d", "90d"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${range === r ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorCurrent" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="colorPrev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.2}/>
                <stop offset="95%" stopColor="#94a3b8" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} dy={10} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `$` + v/1000 + `k`} width={50} />
            <Tooltip
              contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "8px" }}
              itemStyle={{ color: "hsl(var(--foreground))" }}
              formatter={(value: any) => [`$${Number(value).toLocaleString()}`, undefined]}
            />
            <Area type="monotone" dataKey="previous" name="Previous" stroke="#94a3b8" strokeDasharray="4 4" fillOpacity={1} fill="url(#colorPrev)" />
            <Area type="monotone" dataKey="current" name="Current" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorCurrent)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
