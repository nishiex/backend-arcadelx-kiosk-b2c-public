"use client"

import React from "react"

const items = [
  { id: 1, title: "Order #1023", desc: "New order placed", time: "2h ago" },
  { id: 2, title: "Product back in stock", desc: "T-shirt restocked", time: "5h ago" },
  { id: 3, title: "New user", desc: "Jane Doe signed up", time: "1d ago" },
]

export default function RecentActivity() {
  return (
    <ul className="space-y-3">
      {items.map((it) => (
        <li key={it.id} className="flex items-start gap-3">
          <div className="size-8 rounded-full bg-muted flex items-center justify-center text-sm">{it.title.charAt(0)}</div>
          <div>
            <div className="text-sm font-medium">{it.title}</div>
            <div className="text-xs text-muted-foreground">{it.desc} • {it.time}</div>
          </div>
        </li>
      ))}
    </ul>
  )
}
