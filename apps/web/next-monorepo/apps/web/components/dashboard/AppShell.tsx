"use client"

import React from "react"
import Header from "@/components/dashboard/Header"
import Sidebar from "@/components/dashboard/Sidebar"

// The console frame is shared by every organization type: operators keep the
// sidebar console, and IP owners get the same chrome with an IP dashboard inside.
export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background md:flex-row">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="min-w-0 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  )
}
