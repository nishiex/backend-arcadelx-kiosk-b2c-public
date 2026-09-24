"use client"

import React from "react"
import { LucideSettings, LucideRefreshCw, LucideClock } from "lucide-react"
import { Button } from "@/components/ui/button"
import CustomizeDashboard from "@/components/dashboard/CustomizeDashboard"

export default function DashboardHeader({ onOpenCustomize }: { onOpenCustomize?: () => void }) {
  const [open, setOpen] = React.useState(false)

  return (
    <header className="flex items-center justify-between p-4 border-b border-border bg-background">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <LucideClock size={14} /> Sep 21, 2026
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button className="px-2 py-1 rounded-md bg-muted text-sm flex items-center gap-2"><LucideRefreshCw size={16}/> Refresh</button>
        <button onClick={() => { setOpen(true); onOpenCustomize?.() }} className="px-2 py-1 rounded-md bg-muted text-sm flex items-center gap-2"><LucideSettings size={16}/> Customize</button>
      </div>
      <CustomizeDashboard open={open} onOpenChange={(v: boolean) => setOpen(v)} />
    </header>
  )
}
