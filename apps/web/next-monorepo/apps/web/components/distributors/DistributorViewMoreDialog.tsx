"use client"

import React from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { useQuery } from "@tanstack/react-query"
import { Check, X } from "lucide-react"
import { assignKiosks, fetchKiosks, type Distributor } from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"
import { EmptyState } from "@/components/dashboard/ui"
import ReviewRequestList from "@/components/requests/ReviewRequestList"

/**
 * Per-distributor detail view, opened from the row's "View More" action.
 *
 * Three tabs:
 *   - Network connections this distributor's connection requests, accept/approve inline
 *   - Agreements          this distributor's agreements, OWNER-only approval
 *   - Partners            Partners associated with this distributor
 *
 * The two review tabs reuse `ReviewRequestList`, which is the same component the
 * Requests page renders, so the API calls, pagination, loading/error states and
 * authorization rules are shared rather than copied. Because this dialog is
 * Company-side, the lists are scoped to the row's distributor.
 */
type Tab = "kiosks" | "partners" | "network" | "agreements"

/**
 * `GET /api/network/distributors` returns each Distributor's associated Partners alongside
 * its profile fields. The field is declared here rather than added to the shared `Distributor`
 * type: that module is not editable in this workspace, and this dialog is its only consumer,
 * so a local extension keeps the change contained and still type-safe.
 */
type DistributorWithPartners = Distributor & {
  partners?: { id: string; name: string; type: string }[]
}

const TABS: { id: Tab; label: string }[] = [
  { id: "kiosks", label: "Kiosks" },
  { id: "network", label: "Network" },
  { id: "agreements", label: "Agreements" },
  { id: "partners", label: "Partners" },
]

export default function DistributorViewMoreDialog({
  distributor,
  trigger,
}: {
  distributor: DistributorWithPartners
  trigger?: React.ReactElement
}) {
  const { canReviewRequests, me } = useMe()
  const actingOrganizationId = me?.membership?.organizationId
  const [open, setOpen] = React.useState(false)
  const [tab, setTab] = React.useState<Tab>("network")
  const [networkPage, setNetworkPage] = React.useState(1)
  const [agreementPage, setAgreementPage] = React.useState(1)
  const kiosks = useQuery({
    queryKey: ["distributor-kiosks", distributor.id],
    queryFn: fetchKiosks,
    enabled: open && tab === "kiosks",
    staleTime: 10_000,
  })
  const [selectedKioskIds, setSelectedKioskIds] = React.useState<string[]>([])
  const [assigning, setAssigning] = React.useState(false)
  const [assignError, setAssignError] = React.useState<string | null>(null)
  const canAssignKiosks = distributor.agreementStatus === "ACTIVE"

  // Reopening should start clean rather than resume a stale page.
  function change(next: boolean) {
    if (next) {
      setTab("network")
      setNetworkPage(1)
      setAgreementPage(1)
      setSelectedKioskIds([])
      setAssignError(null)
    }
    setOpen(next)
  }

  return (
    <Dialog.Root open={open} onOpenChange={change}>
      <Dialog.Trigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label={`Open ${distributor.name}`}
            className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            Open
          </button>
        )}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border bg-card text-card-foreground shadow-xl">
          <header className="border-b border-border p-4 pr-12 sm:p-6">
            <Dialog.Title className="break-words text-xl font-semibold">{distributor.name}</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">
              Review this distributor&apos;s network, agreements and associated partners.
            </Dialog.Description>
            <Dialog.Close
              aria-label="Close distributor details"
              className="absolute right-3 top-3 rounded-md p-2 hover:bg-muted"
            >
              <X size={18} />
            </Dialog.Close>
          </header>

          <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3 sm:px-6" role="tablist" aria-label="Distributor sections">
            {TABS.map(item => (
              <button
                key={item.id}
                type="button"
                id={`distributor-tab-${item.id}`}
                role="tab"
                aria-selected={tab === item.id}
                aria-controls={`distributor-panel-${item.id}`}
                tabIndex={tab === item.id ? 0 : -1}
                onClick={() => setTab(item.id)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                  tab === item.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card hover:bg-muted"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div
            id={`distributor-panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`distributor-tab-${tab}`}
            tabIndex={0}
            className="min-h-0 flex-1 overflow-y-auto p-4 outline-none sm:p-6"
          >
            {tab === "kiosks" ? (
              kiosks.isLoading ? (
                <p role="status" className="text-sm text-muted-foreground">Loading assigned kiosks…</p>
              ) : kiosks.isError ? (
                <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                  <p role="alert" className="text-destructive">Couldn&apos;t load this distributor&apos;s assigned kiosks.</p>
                  <button type="button" onClick={() => void kiosks.refetch()} className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted">
                    Retry
                  </button>
                </div>
              ) : (
                <div className="space-y-5">
                  <section className="overflow-x-auto rounded-xl border border-border bg-card">
                    <div className="border-b border-border px-4 py-3">
                      <h3 className="text-sm font-semibold">Assigned kiosks</h3>
                    </div>
                    {!kiosks.data?.filter(kiosk => kiosk.currentOrgId === distributor.id).length ? (
                      <p className="p-4 text-sm text-muted-foreground">No kiosks are currently assigned to this distributor.</p>
                    ) : <table className="w-full text-sm">
                    <thead className="border-b border-border text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">Machine code</th>
                        <th className="px-4 py-3 font-medium">Model</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Location</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {kiosks.data
                        .filter(kiosk => kiosk.currentOrgId === distributor.id)
                        .map(kiosk => (
                          <tr key={kiosk.id}>
                            <td className="px-4 py-3 font-mono font-medium">{kiosk.machineCode}</td>
                            <td className="px-4 py-3">{kiosk.model ?? "—"}</td>
                            <td className="px-4 py-3">{kiosk.status.replaceAll("_", " ")}</td>
                            <td className="px-4 py-3 text-muted-foreground">{kiosk.location ?? "—"}</td>
                          </tr>
                        ))}
                    </tbody>
                    </table>}
                  </section>
                  {me?.membership?.organization.type === "COMPANY" && actingOrganizationId && (
                    <section className="rounded-xl border border-border bg-card p-4">
                      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold">Assign kiosks</h3>
                          <p className="mt-1 text-xs text-muted-foreground">Choose available machines from your inventory and assign them to this distributor.</p>
                        </div>
                        <button
                          type="button"
                          disabled={!selectedKioskIds.length || assigning || !canAssignKiosks}
                          onClick={async () => {
                            setAssigning(true)
                            setAssignError(null)
                            try {
                              await assignKiosks({ organizationId: distributor.id, kioskIds: selectedKioskIds })
                              setSelectedKioskIds([])
                              await kiosks.refetch()
                            } catch (error) {
                              setAssignError(error instanceof Error ? error.message : "Couldn’t assign kiosks.")
                            } finally {
                              setAssigning(false)
                            }
                          }}
                          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Check size={14} /> {assigning ? "Assigning…" : `Assign${selectedKioskIds.length ? ` (${selectedKioskIds.length})` : ""}`}
                        </button>
                      </div>
                      {!canAssignKiosks && <p className="mb-3 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">Approve the Distributor agreement before assigning kiosks.</p>}
                      {assignError && <p role="alert" className="mb-3 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">{assignError}</p>}
                      {!kiosks.data?.filter(kiosk => kiosk.currentOrgId === actingOrganizationId && ["AVAILABLE", "RETURNED", "MAINTENANCE"].includes(kiosk.status)).length ? (
                        <p className="text-sm text-muted-foreground">No available kiosks are currently in your inventory.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="border-b border-border text-left text-xs text-muted-foreground">
                              <tr><th className="w-10 px-2 py-2" /><th className="px-2 py-2 font-medium">Machine code</th><th className="px-2 py-2 font-medium">Model</th><th className="px-2 py-2 font-medium">Status</th></tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {kiosks.data.filter(kiosk => kiosk.currentOrgId === actingOrganizationId && ["AVAILABLE", "RETURNED", "MAINTENANCE"].includes(kiosk.status)).map(kiosk => {
                                const checked = selectedKioskIds.includes(kiosk.id)
                                return <tr key={kiosk.id} className={checked ? "bg-primary/5" : undefined}>
                                  <td className="px-2 py-2"><input type="checkbox" aria-label={`Select ${kiosk.machineCode}`} checked={checked} onChange={() => setSelectedKioskIds(ids => checked ? ids.filter(id => id !== kiosk.id) : [...ids, kiosk.id])} /></td>
                                  <td className="px-2 py-2 font-mono font-medium">{kiosk.machineCode}</td>
                                  <td className="px-2 py-2">{kiosk.model ?? "—"}</td>
                                  <td className="px-2 py-2 text-xs text-muted-foreground">{kiosk.status.replaceAll("_", " ")}</td>
                                </tr>
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </section>
                  )}
                </div>
              )
            ) : tab === "partners" ? (
              /* Partners genuinely associated with this Distributor, as returned by the API.
                 A Partner registration records no parent pointer, so this is derived from
                 existing connections/agreements/orders -- an empty list is a real answer,
                 not a loading failure. */
              !distributor.partners?.length ? (
                <EmptyState message="No Partners are associated with this distributor yet. A Partner appears here once it is registered by, or shares an agreement or order with, this distributor." />
              ) : (
                <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                  {distributor.partners.map(partner => (
                    <li key={partner.id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{partner.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{partner.type}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            ) : !canReviewRequests ? (
              <EmptyState message="Only organization Owners and Admins can review requests." />
            ) : tab === "network" ? (
              <ReviewRequestList
                kind="network"
                page={networkPage}
                onPageChange={setNetworkPage}
                counterpartyId={distributor.id}
              />
            ) : (
              <ReviewRequestList
                kind="agreements"
                page={agreementPage}
                onPageChange={setAgreementPage}
                counterpartyId={distributor.id}
              />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
