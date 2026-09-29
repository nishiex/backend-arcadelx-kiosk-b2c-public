"use client"

import React from "react"
import { Search, Eye, MonitorSmartphone, ChevronLeft, ChevronRight } from "lucide-react"
import { type Kiosk } from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"
import { useOwnedKiosks } from "@/hooks/useOwnedKiosks"
import { Skeleton, ErrorState, EmptyState, StatusBadge } from "@/components/dashboard/ui"
import AddMachineDialog from "./AddMachineDialog"
import KioskDetailDialog from "./KioskDetailDialog"

const PAGE_SIZES = [10, 25, 50, 100]
const pageButtonClass = "inline-flex min-h-8 min-w-8 items-center justify-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"

function pageNumbers(page: number, totalPages: number): (number | "start-gap" | "end-gap")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
  if (page <= 4) return [1, 2, 3, 4, 5, "end-gap", totalPages]
  if (page >= totalPages - 3) return [1, "start-gap", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  return [1, "start-gap", page - 1, page, page + 1, "end-gap", totalPages]
}

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

  // Apply ownership before search, model options and local pagination.
  const { data, isLoading, isFetching, isError, refetch } = useOwnedKiosks()

  const [q, setQ] = React.useState("")
  const [modelFilter, setModelFilter] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(10)
  const [selected, setSelected] = React.useState<Kiosk | null>(null)
  const [detailOpen, setDetailOpen] = React.useState(false)

  const kiosks = data ?? []
  const models = Array.from(new Set(kiosks.map((k) => k.model).filter((model): model is string => !!model)))
    .sort((a, b) => a.localeCompare(b))
  const filtered = kiosks.filter((k) => {
    const matchesSearch = !q || k.machineCode.toLowerCase().includes(q.toLowerCase()) || (k.model ?? "").toLowerCase().includes(q.toLowerCase())
    return matchesSearch && (!modelFilter || k.model === modelFilter)
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  // A refetch can reduce the inventory while a later page is selected.
  const currentPage = Math.min(page, totalPages)
  const start = (currentPage - 1) * pageSize
  const visibleKiosks = filtered.slice(start, start + pageSize)

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
      <div className="rounded-xl border border-border bg-card" aria-busy={isFetching}>
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
          <div className="relative w-full min-w-0 sm:min-w-[220px] sm:flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
              aria-label="Search machines"
              placeholder="Search by code or model…"
              className="w-full rounded-lg border border-input bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
          <label className="flex w-full min-w-0 items-center gap-2 text-xs text-muted-foreground sm:w-auto">
            Model
            <select
              aria-label="Model"
              value={modelFilter}
              disabled={isLoading || isError}
              onChange={(e) => {
                setModelFilter(e.target.value)
                setPage(1)
              }}
              className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40 disabled:opacity-50 sm:max-w-[220px] sm:flex-none"
            >
              <option value="">All models</option>
              {models.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Rows per page
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setPage(1)
              }}
              className="rounded-lg border border-input bg-background px-2.5 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
            >
              {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
        </div>

        {isLoading ? (
          <div className="divide-y divide-border" role="status">
            <span className="sr-only">Loading machines...</span>
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
            message="No machines in your inventory."
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
                {visibleKiosks.map((k) => (
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

        {!isLoading && !isError && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
            <div className="space-y-1 text-xs text-muted-foreground" role="status">
              <p>
                Showing {filtered.length ? start + 1 : 0}–{start + visibleKiosks.length} of {filtered.length} machines
                {(q || modelFilter) && ` (filtered from ${kiosks.length})`}
              </p>
              <p>Page {currentPage} of {totalPages}{isFetching && " · Updating..."}</p>
            </div>
            <nav aria-label="Kiosk pagination" className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                aria-label="Previous page"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
                className={pageButtonClass}
              >
                <ChevronLeft size={14} aria-hidden="true" /> Previous
              </button>
              {pageNumbers(currentPage, totalPages).map((item) => (
                typeof item === "number" ? (
                  <button
                    key={item}
                    type="button"
                    aria-label={`Page ${item}`}
                    aria-current={item === currentPage ? "page" : undefined}
                    onClick={() => setPage(item)}
                    className={`${pageButtonClass} ${item === currentPage ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90" : ""}`}
                  >
                    {item}
                  </button>
                ) : (
                  <span key={item} className="px-1 text-xs text-muted-foreground" aria-hidden="true">…</span>
                )
              ))}
              <button
                type="button"
                aria-label="Next page"
                disabled={currentPage === totalPages}
                onClick={() => setPage(currentPage + 1)}
                className={pageButtonClass}
              >
                Next <ChevronRight size={14} aria-hidden="true" />
              </button>
            </nav>
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
