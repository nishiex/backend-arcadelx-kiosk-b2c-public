"use client"

import React from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { useQuery } from "@tanstack/react-query"
import { Undo2, X } from "lucide-react"
import { deactivateKiosks, fetchKiosks, type Distributor } from "@/lib/backend-api"
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
type Tab = "kiosks" | "partners" | "agreements"

/**
 * `GET /api/network/distributors` returns each Distributor's associated Partners alongside
 * its profile fields. The field is declared here rather than added to the shared `Distributor`
 * type: that module is not editable in this workspace, and this dialog is its only consumer,
 * so a local extension keeps the change contained and still type-safe.
 */
type DistributorWithPartners = Distributor & {
  partners?: { id: string; name: string; type: string }[]
}

function PartnerAgreementAndMachines({
  partner,
  kiosks,
}: {
  partner: { id: string; name: string; type: string }
  kiosks: Awaited<ReturnType<typeof fetchKiosks>> | undefined
}) {
  const [agreementPage, setAgreementPage] = React.useState(1)
  const assigned = (kiosks ?? []).filter(kiosk => kiosk.currentOrgId === partner.id)

  return (
    <div className="mt-4 grid gap-4 border-t border-border pt-4 lg:grid-cols-2">
      <section>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Agreement</h4>
        <ReviewRequestList kind="agreements" page={agreementPage} onPageChange={setAgreementPage} counterpartyId={partner.id} />
      </section>
      <section className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold">Assigned machines</h4>
          <span className="text-xs text-muted-foreground">{assigned.length} machine{assigned.length === 1 ? "" : "s"}</span>
        </div>
        {!assigned.length ? (
          <p className="text-xs text-muted-foreground">No machines are currently assigned to this Partner.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground"><tr><th className="pb-2 pr-3 font-medium">Machine code</th><th className="pb-2 pr-3 font-medium">Status</th><th className="pb-2 font-medium">Location</th></tr></thead>
              <tbody className="divide-y divide-border/60">{assigned.map(kiosk => <tr key={kiosk.id}><td className="py-2 pr-3 font-mono font-medium">{kiosk.machineCode}</td><td className="py-2 pr-3">{kiosk.status.replaceAll("_", " ")}</td><td className="py-2 text-muted-foreground">{kiosk.location ?? "—"}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

const TABS: { id: Tab; label: string }[] = [
  { id: "kiosks", label: "Kiosks" },
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
  const { canReviewRequests } = useMe()
  const [open, setOpen] = React.useState(false)
  const [tab, setTab] = React.useState<Tab>("kiosks")
  const [agreementPage, setAgreementPage] = React.useState(1)
  const kiosks = useQuery({
    queryKey: ["distributor-kiosks", distributor.id],
    queryFn: fetchKiosks,
    enabled: open && tab === "kiosks",
    staleTime: 10_000,
  })
  const [unassigningId, setUnassigningId] = React.useState<string | null>(null)
  const [assignError, setAssignError] = React.useState<string | null>(null)
  const [expandedPartnerId, setExpandedPartnerId] = React.useState<string | null>(null)

  // Reopening should start clean rather than resume a stale page.
  function change(next: boolean) {
    if (next) {
      setTab("kiosks")
      setAgreementPage(1)
      setAssignError(null)
      setExpandedPartnerId(null)
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
                    {assignError && <p role="alert" className="border-b border-border bg-destructive/10 p-3 text-xs text-destructive">{assignError}</p>}
                    {!kiosks.data?.filter(kiosk => kiosk.currentOrgId === distributor.id).length ? (
                      <p className="p-4 text-sm text-muted-foreground">No kiosks are currently assigned to this distributor.</p>
                    ) : <table className="w-full text-sm">
                    <thead className="border-b border-border text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">Machine code</th>
                        <th className="px-4 py-3 font-medium">Model</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Location</th>
                        <th className="px-4 py-3 text-right font-medium">Action</th>
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
                            <td className="px-4 py-3 text-right">
                              <button
                                type="button"
                                disabled={unassigningId !== null || !["AVAILABLE", "RETURNED", "MAINTENANCE"].includes(kiosk.status)}
                                onClick={async () => {
                                  if (!window.confirm(`Deactivate ${kiosk.machineCode}? Its ownership and history will be preserved.`)) return
                                  setUnassigningId(kiosk.id)
                                  setAssignError(null)
                                  try {
                                    await deactivateKiosks({ organizationId: distributor.id, kioskIds: [kiosk.id] })
                                    await kiosks.refetch()
                                  } catch (error) {
                                    setAssignError(error instanceof Error ? error.message : "Couldn’t deactivate kiosk.")
                                  } finally {
                                    setUnassigningId(null)
                                  }
                                }}
                                className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Undo2 size={13} /> {unassigningId === kiosk.id ? "Deactivating…" : "Deactivate"}
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                    </table>}
                  </section>
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
                    <li key={partner.id} className="p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{partner.name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{partner.type}</p>
                        </div>
                        <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted" onClick={() => setExpandedPartnerId(current => current === partner.id ? null : partner.id)}>
                          {expandedPartnerId === partner.id ? "Hide details" : "View agreement & machines"}
                        </button>
                      </div>
                      {expandedPartnerId === partner.id && <PartnerAgreementAndMachines partner={partner} kiosks={kiosks.data} />}
                    </li>
                  ))}
                </ul>
              )
            ) : !canReviewRequests ? (
              <EmptyState message="Only organization Owners and Admins can review requests." />
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
