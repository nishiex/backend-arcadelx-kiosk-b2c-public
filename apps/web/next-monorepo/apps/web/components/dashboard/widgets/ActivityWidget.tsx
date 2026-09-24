"use client"

import React from "react"

export default function ActivityWidget() {
  const items = [
    { id: 1, title: "New order #10291", time: "2h ago" },
    { id: 2, title: "Payment processed #10290", time: "5h ago" },
    { id: 3, title: "User signed up: jane@example.com", time: "1d ago" },
  ]

  return (
    <div>
      <div className="text-sm text-muted-foreground mb-2">Recent Activity</div>
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id} className="text-sm">
            <div className="font-medium">{it.title}</div>
            <div className="text-xs text-muted-foreground">{it.time}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}
