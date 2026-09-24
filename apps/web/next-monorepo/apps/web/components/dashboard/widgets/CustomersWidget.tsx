"use client"

import React from "react"

export default function CustomersWidget() {
  const customers = [
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
    { id: 3, name: "Jane" },
  ]

  return (
    <div>
      <div className="text-sm text-muted-foreground mb-2">Top Customers</div>
      <ul className="space-y-2">
        {customers.map((c) => (
          <li key={c.id} className="flex items-center justify-between">
            <div className="font-medium">{c.name}</div>
            <div className="text-xs text-muted-foreground">Orders: {Math.floor(Math.random()*20)+1}</div>
          </li>
        ))}
      </ul>
    </div>
  )
}
