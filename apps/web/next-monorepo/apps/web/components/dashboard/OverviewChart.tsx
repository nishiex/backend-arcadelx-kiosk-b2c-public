"use client"

import React from "react"

const data = [10, 20, 15, 30, 25, 40, 35]

export default function OverviewChart() {
  const max = Math.max(...data)
  const points = data.map((d, i) => `${(i / (data.length - 1)) * 100}, ${100 - (d / max) * 100}`).join(" ")
  return (
    <div className="h-64 w-full">
      <svg viewBox="0 0 100 100" className="w-full h-full">
        <polyline fill="none" stroke="var(--color-chart-2, #3b82f6)" strokeWidth="2" points={points} />
      </svg>
    </div>
  )
}
