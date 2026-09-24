"use client"

import React from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchPendingMembers, PendingMembersResponse } from "@/lib/backend-api"

export default function PendingMembersWidget() {
  const { data, isLoading, isError } = useQuery<PendingMembersResponse>({ queryKey: ["pendingMembers", 1, 10], queryFn: () => fetchPendingMembers(1, 10) })

  if (isLoading) return <div className="h-64 flex items-center justify-center">Loading...</div>
  if (isError) return <div className="h-64 flex items-center justify-center text-sm text-destructive">Failed to load pending members</div>

  const items = data?.data || []

  if (!items.length) return <div className="text-sm text-muted-foreground">No pending member requests.</div>

  return (
    <div className="overflow-auto max-h-64">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="text-left py-1">Request</th>
            <th className="text-left py-1">User</th>
            <th className="text-left py-1">Requested At</th>
          </tr>
        </thead>
        <tbody>
          {items.map((o: any) => (
            <tr key={o.id} className="border-t border-border">
              <td className="py-2">#{o.id}</td>
              <td className="py-2">{o.user?.name ?? o.user?.email ?? '—'}</td>
              <td className="py-2">{o.user?.createdAt ? new Date(o.user.createdAt).toLocaleString() : (o.createdAt ? new Date(o.createdAt).toLocaleString() : '—')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
