"use client"

import React from "react"

const stats = [
  { id: 1, label: "Revenue", value: ",400", change: "+4.6%" },
  { id: 2, label: "Orders", value: "1,240", change: "-1.2%" },
  { id: 3, label: "Customers", value: "3,210", change: "+3.2%" },
  { id: 4, label: "Conversion", value: "2.8%", change: "+0.4%" },
]

export default function StatsCards() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((s) => (
        <div key={s.id} className="bg-card border border-border rounded-md p-4">
          <div className="text-xs text-muted-foreground">{s.label}</div>
          <div className="mt-2 text-2xl font-semibold">{s.value}</div>
          <div className="mt-1 text-sm text-muted-foreground">{s.change}</div>
        </div>
      ))}
    </div>
  )
}
