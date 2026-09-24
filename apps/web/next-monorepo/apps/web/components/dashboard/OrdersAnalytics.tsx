"use client"
import React, { useEffect, useRef } from "react"
import { ordersData } from "@/lib/mock-data"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts"
import { gsap } from "gsap"

export function OrdersAnalytics() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return
    gsap.fromTo(containerRef.current, { opacity: 0, x: 20 }, { opacity: 1, x: 0, duration: 0.8, ease: "power2.out", delay: 0.2 })
  }, [])

  return (
    <div ref={containerRef} className="col-span-1 md:col-span-2 lg:col-span-3 xl:col-span-1 2xl:col-span-2 border border-border bg-card rounded-xl p-5 flex flex-col">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">Weekly Orders</h2>
        <p className="text-sm text-muted-foreground">Orders vs Returns</p>
      </div>
      <div className="flex-1 min-h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={ordersData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} dy={10} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted))" }}
              contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "8px" }}
            />
            <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "10px" }} />
            <Bar dataKey="orders" name="Orders" fill="#10b981" radius={[4, 4, 0, 0]} />
            <Bar dataKey="returns" name="Returns" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
