"use client"

import React from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Plus, Building2 } from "lucide-react"
import { fetchDistributors } from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"
import { useReveal } from "@/hooks/useReveal"
import { Skeleton, ErrorState, EmptyState } from "@/components/dashboard/ui"

export default function DistributorsScreen() {
  const { canManageDistributors, can } = useMe()
  const canAdd = canManageDistributors && can("DISTRIBUTORS", "CREATE")
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["distributors"],
    queryFn: fetchDistributors,
  })

  const distributors = data ?? []
  const bodyRef = useReveal<HTMLTableSectionElement>([distributors.length])

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Distributors</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage the distributor organizations in your network.
          </p>
        </div>
        {canAdd && (
          <Link
            href="/distributors/new"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            <Plus size={16} /> Register Distributors
          </Link>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card">
        {isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-4">
                <Skeleton className="h-9 w-9 rounded-full" />
                <Skeleton className="h-9 flex-1" />
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-16" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <ErrorState className="py-12" message="Couldn't load distributors." onRetry={() => refetch()} />
        ) : !distributors.length ? (
          <EmptyState
            className="py-14"
            icon={<Building2 size={30} />}
            message={
              canAdd
                ? "No distributors yet. Use \"Add Distributor\" to create one."
                : "No distributors to show."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Business</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">GST</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 text-right font-medium">Kiosks</th>
                  <th className="px-4 py-3 text-right font-medium">Members</th>
                </tr>
              </thead>
              <tbody ref={bodyRef}>
                {distributors.map((d) => (
                  <tr
                    key={d.id}
                    data-reveal
                    className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                          {d.name.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{d.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {d.owner?.email ?? "—"}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {[d.city, d.state].filter(Boolean).join(", ") || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3">{d.gstNumber ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3">{d.phone ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{d._count.kiosks}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{d._count.memberships}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
              {distributors.length} distributor{distributors.length === 1 ? "" : "s"}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
