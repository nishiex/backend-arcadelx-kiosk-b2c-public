"use client"

import React from "react"
import { useQuery } from "@tanstack/react-query"
import { Search, Eye, MonitorSmartphone } from "lucide-react"
import { fetchKiosks, type Kiosk } from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"
import { Skeleton, ErrorState, EmptyState, StatusBadge } from "@/components/dashboard/ui"
import AddMachineDialog from "./AddMachineDialog"
import KioskDetailDialog from "./KioskDetailDialog"

/** Renders the real holder org (and sub-org, if placed further) for a kiosk. */
function AssignedCell({ k }: { k: Kiosk }) {
  // No holder org at all → in unassigned pool.
  if (!k.currentOrgId && !k.assignedOrg) {
    return <span className="text-muted-foreground">Unassigned</span>
  }
  // Holder id present but the org record couldn't be resolved (deleted/missing).
  if (k.currentOrgId && !k.currentOrg) {
    return <span className="italic text-muted-foreground">Unknown organization</span>
  }
  const holder = k.currentOrg
  const sub = k.assignedOrg && k.assignedOrg.id !== holder?.id ? k.assignedOrg : null

  // Company-held with no further placement = still in company stock.
  if (holder?.type === "COMPANY" && !sub) {
    return <span className="text-muted-foreground">Unassigned</span>
  }

  const primary = holder?.name ?? sub?.name
  return (
    <div>
      <div className="font-medium">{primary}</div>
      {sub && <div className="text-xs text-muted-foreground">↳ {sub.name}</div>}
    </div>
  )
}

export default function KiosksScreen() {
  const { isCompany, canTransact, orgType } = useMe()

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["kiosks"],
    queryFn: fetchKiosks,
  })

  const [q, setQ] = React.useState("")
  const [selected, setSelected] = React.useState<Kiosk | null>(null)
  const [detailOpen, setDetailOpen] = React.useState(false)

  const kiosks = data ?? []
  const filtered = kiosks.filter((k) => {
    return !q || k.machineCode.toLowerCase().includes(q.toLowerCase()) || (k.model ?? "").toLowerCase().includes(q.toLowerCase())
  })

  const openDetail = (k: Kiosk) => {
    setSelected(k)
    setDetailOpen(true)
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Machines</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage and monitor every kiosk in the {orgType === "COMPANY" ? "company's" : "your"} fleet.
          </p>
        </div>
        {isCompany && <AddMachineDialog />}
      </div>

      {/* Toolbar + table */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by code or model…"
              className="w-full rounded-lg border border-input bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-4">
                <Skeleton className="h-9 flex-1" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-8 w-16" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <ErrorState className="py-12" message="Couldn't load machines." onRetry={() => refetch()} />
        ) : !kiosks.length ? (
          <EmptyState
            className="py-12"
            message={isCompany ? "No machines yet. Use \"Add Machine\" to mint your first batch." : "No machines in your inventory yet."}
            icon={<MonitorSmartphone size={30} />}
          />
        ) : !filtered.length ? (
          <EmptyState className="py-12" message="No machines match your filters." icon={<Search size={28} />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Machine Code</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Assigned To</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Model</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((k) => (
                  <tr key={k.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <div className="font-mono font-medium">{k.machineCode}</div>
                      <div className="text-xs text-muted-foreground">
                        {k.serialNumber ?? `SN-${k.id.slice(0, 8).toUpperCase()}`}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={k.status} />
                    </td>
                    <td className="px-4 py-3"><AssignedCell k={k} /></td>
                    <td className="px-4 py-3">{typeof k.location === "string" ? k.location : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3">{k.model ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openDetail(k)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                      >
                        <Eye size={14} /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!isLoading && !isError && filtered.length > 0 && (
          <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            Showing {filtered.length} of {kiosks.length} machines
          </div>
        )}
      </div>

      <KioskDetailDialog
        kiosk={selected}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        canEdit={canTransact}
      />
    </div>
  )
}
