"use client"

import React from "react"
import { Search, Eye, MonitorSmartphone, ChevronLeft, ChevronRight } from "lucide-react"
import { type Kiosk, type OrgRef } from "@/lib/backend-api"
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

/** Assignment dates are timestamps; render them as a stable, locale-fixed label. */
function formatAssignedAt(value?: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
}

/** Renders the real holder org (and sub-org, if placed further) for a kiosk. */
function AssignedCell({
  k,
  myOrgId,
  viewerIsDistributor,
}: {
  k: Kiosk
  myOrgId?: string
  viewerIsDistributor: boolean
}) {
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

  // A Distributor reads its own shelf as inventory, not as an org it assigned to.
  if (viewerIsDistributor && holder?.id && holder.id === myOrgId) {
    return <span className="text-muted-foreground">Your inventory</span>
  }

  const primary = holder ?? sub
  const typeLabel =
    primary?.type === "PARTNER" ? "Partner" : primary?.type === "DISTRIBUTOR" ? "Distributor" : null
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{primary?.name}</span>
        {typeLabel && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {typeLabel}
          </span>
        )}
      </div>
      {sub && <div className="text-xs text-muted-foreground">↳ {sub.name}</div>}
    </div>
  )
}

export default function KiosksScreen() {
  const { isCompany, canTransact, isMasterAdmin, orgType, me } = useMe()
  const myOrgId = me?.membership?.organizationId

  // Apply ownership before search, model options and local pagination.
  // Whoever runs the network sees where the fleet went: a Distributor its placed machines, the
  // Company master admin the whole chain down to Partners. Everyone else keeps their own stock.
  const showNetworkInventory = orgType === "DISTRIBUTOR" || isMasterAdmin
  const { data, isLoading, isFetching, isError, refetch } = useOwnedKiosks({
    includeNetworkInventory: showNetworkInventory,
  })

  const [q, setQ] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(10)
  // Machines only start charging once a kiosk is paired to hardware, so the default
  // view is the fleet that is actually live. Unpaired rows stay one selection away.
  const [pairedOnly, setPairedOnly] = React.useState(true)
  // Narrows the network view to one child org (or the viewer's own stock). Options are derived
  // from the rows already loaded, so this needs no extra request.
  const [assignedTo, setAssignedTo] = React.useState("all")
  const [selected, setSelected] = React.useState<Kiosk | null>(null)
  const [detailOpen, setDetailOpen] = React.useState(false)

  const kiosks = data ?? []
  const pairedKiosks = kiosks.filter((k) => !!k.externalDeviceId)

  // Machines held by another org, one option per org. A Distributor with two Partners sees two.
  const holderOrgs = React.useMemo(() => {
    const byId = new Map<string, OrgRef>()
    for (const kiosk of data ?? []) {
      const org = kiosk.currentOrg
      if (org && org.id !== myOrgId && org.type === "PARTNER") byId.set(org.id, org)
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [data, myOrgId])

  const holderCounts = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const kiosk of data ?? []) {
      const id = kiosk.currentOrg?.id
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return counts
  }, [data])

  // A refetch can drop the org that was selected; fall back to "all" instead of an empty list.
  const activeAssignedTo =
    assignedTo === "all" || holderOrgs.some((org) => org.id === assignedTo) ? assignedTo : "all"

  const filtered = kiosks.filter((k) => {
    const matchesSearch = !q || k.machineCode.toLowerCase().includes(q.toLowerCase())
    const holderId = k.currentOrg?.id ?? k.assignedOrg?.id ?? null
    const matchesAssigned =
      activeAssignedTo === "all" ? true : holderId === activeAssignedTo
    return matchesSearch && (!pairedOnly || !!k.externalDeviceId) && matchesAssigned
  })
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  // A refetch can reduce the inventory while a later page is selected.
  const currentPage = Math.min(page, totalPages)
  const start = (currentPage - 1) * pageSize
  const visibleKiosks = filtered.slice(start, start + pageSize)

  // Re-point the open dialog at the refetched row, so an unpair that happens while it is open
  // updates the status instead of leaving a snapshot on screen.
  const selectedKiosk = selected ? kiosks.find((k) => k.id === selected.id) ?? selected : null

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
        {isCompany && (
          <AddMachineDialog
            onMinted={() => {
              // Freshly minted machines have no hardware yet, so reveal the unpaired ones
              // the operator just created instead of leaving the list looking unchanged.
              setPairedOnly(false)
              setPage(1)
            }}
          />
        )}
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
              placeholder="Search by machine code…"
              className="w-full rounded-lg border border-input bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Pairing
            <select
              value={pairedOnly ? "paired" : "all"}
              disabled={isLoading || isError}
              onChange={(e) => {
                setPairedOnly(e.target.value === "paired")
                setPage(1)
              }}
              className="rounded-lg border border-input bg-background px-2.5 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
            >
              <option value="paired">Paired only ({pairedKiosks.length}/{kiosks.length})</option>
              <option value="all">All machines ({kiosks.length})</option>
            </select>
          </label>
          {orgType === "DISTRIBUTOR" && (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Assigned to
                <select
                  value={activeAssignedTo}
                  disabled={!holderOrgs.length}
                  onChange={(e) => {
                    setAssignedTo(e.target.value || "all")
                    setPage(1)
                  }}
                  className="rounded-lg border border-input bg-background px-2.5 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
                >
                  {holderOrgs.length ? (
                    <>
                      <option value="all">All partners</option>
                      {holderOrgs.map((org) => (
                        <option key={org.id} value={org.id}>
                          {org.name} ({holderCounts.get(org.id) ?? 0})
                        </option>
                      ))}
                    </>
                  ) : (
                    <option value="all">No partner yet</option>
                  )}
                </select>
              </label>
              {activeAssignedTo !== "all" && (
                <button
                  type="button"
                  onClick={() => {
                    setAssignedTo("all")
                    setPage(1)
                  }}
                  className="rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Clear
                </button>
              )}
            </div>
          )}
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
          <EmptyState
            className="py-12"
            message={
              pairedOnly && kiosks.length > 0
                ? 'No paired machines match your filters. Choose "All machines" to see every machine.'
                : "No machines match your filters."
            }
            icon={<Search size={28} />}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Machine Code</th>
                  <th className="px-4 py-3 font-medium">Pairing</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Assigned To</th>
                  <th className="px-4 py-3 font-medium">Assigned</th>
                  <th className="px-4 py-3 font-medium">Location</th>
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
                      {/* Pairing is separate from lifecycle status: a kiosk can be
                          AVAILABLE and still have no hardware attached. */}
                      {k.externalDeviceId ? (
                        <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                          Paired
                        </span>
                      ) : (
                        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                          Unpaired
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={k.status} />
                    </td>
                    <td className="px-4 py-3">
                      <AssignedCell k={k} myOrgId={myOrgId} viewerIsDistributor={orgType === "DISTRIBUTOR"} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-xs text-muted-foreground">
                      {formatAssignedAt(k.assignedAt)}
                    </td>
                    <td className="px-4 py-3">{typeof k.location === "string" ? k.location : <span className="text-muted-foreground">—</span>}</td>
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
                {(q || activeAssignedTo !== "all" || (pairedOnly && pairedKiosks.length !== kiosks.length)) &&
                  ` (filtered from ${kiosks.length})`}
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
        kiosk={selectedKiosk}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        canEdit={canTransact}
        onRemoved={() => void refetch()}
      />
    </div>
  )
}
