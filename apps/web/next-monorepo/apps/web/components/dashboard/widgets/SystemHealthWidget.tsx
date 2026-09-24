"use client"

import React from "react"

export default function SystemHealthWidget() {
  return (
    <div>
      <div className="text-sm text-muted-foreground mb-2">System Health</div>
      <div className="flex items-center gap-3">
        <div className="size-3 rounded-full bg-green-500" />
        <div>
          <div className="font-medium">Operational</div>
          <div className="text-xs text-muted-foreground">99.98% uptime</div>
        </div>
      </div>
    </div>
  )
}
