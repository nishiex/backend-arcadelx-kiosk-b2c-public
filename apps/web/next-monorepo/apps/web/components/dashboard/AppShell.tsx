"use client"

import React from "react"
import Header from "@/components/dashboard/Header"
import Sidebar from "@/components/dashboard/Sidebar"
import IpStudioShell from "@/components/ip/IpStudioShell"
import { useMe } from "@/hooks/useMe"

// Chooses the chrome for the signed-in organization. Operators keep the familiar
// sidebar console; IP owners get the studio surface, which shares no navigation,
// colours or layout with it. While /me is still in flight the operator shell is
// rendered, so the common case paints without waiting.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { orgType } = useMe()

  if (orgType === "IP_PARTY") {
    return <IpStudioShell>{children}</IpStudioShell>
  }

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
