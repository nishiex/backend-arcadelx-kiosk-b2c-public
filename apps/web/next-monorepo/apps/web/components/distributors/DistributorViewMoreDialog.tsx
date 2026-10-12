"use client"

import React from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import type { Distributor } from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"
import { EmptyState } from "@/components/dashboard/ui"
import ReviewRequestList from "@/components/requests/ReviewRequestList"

/**
 * Per-distributor detail view, opened from the row's "View More" action.
 *
 * Three tabs:
 *   - Details             the organization's own fields
 *   - Network connections this distributor's connection requests, accept/approve inline
 *   - Agreements          this distributor's agreements, OWNER-only approval
 *
 * The two review tabs reuse `ReviewRequestList`, which is the same component the
 * Requests page renders, so the API calls, pagination, loading/error states and
 * authorization rules are shared rather than copied. Because this dialog is
 * Company-side, the lists are scoped to the row's distributor.
 */
type Tab = "details" | "partners" | "network" | "agreements"

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
  { id: "details", label: "Details" },
  // Partners are shown before the review tabs: they answer "who operates here", which is
  // what the Company most often opens this dialog for.
  { id: "partners", label: "Partners" },
  { id: "network", label: "Network connections" },
  { id: "agreements", label: "Agreements" },
]

/** Indian digit grouping, matching the currency format used elsewhere in the app. */
const countFormat = new Intl.NumberFormat("en-IN")

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words">{value ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  )
}

export default function DistributorViewMoreDialog({ distributor }: { distributor: DistributorWithPartners }) {
  const { canReviewRequests } = useMe()
  const [open, setOpen] = React.useState(false)
  const [tab, setTab] = React.useState<Tab>("details")
  const [networkPage, setNetworkPage] = React.useState(1)
  const [agreementPage, setAgreementPage] = React.useState(1)

  // Reopening should start clean rather than resume a stale page.
  function change(next: boolean) {
    if (next) {
      setTab("details")
      setNetworkPage(1)
      setAgreementPage(1)
    }
    setOpen(next)
  }

  const location = [distributor.city, distributor.state].filter(Boolean).join(", ")

  return (
    <Dialog.Root open={open} onOpenChange={change}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={`View More ${distributor.name}`}
          className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          View More
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border bg-card text-card-foreground shadow-xl">
          <header className="border-b border-border p-4 pr-12 sm:p-6">
            <Dialog.Title className="break-words text-xl font-semibold">{distributor.name}</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">
              Details, connection requests and agreements for this distributor.
            </Dialog.Description>
            <Dialog.Close
              aria-label="Close distributor details"
              className="absolute right-3 top-3 rounded-md p-2 hover:bg-muted"
            >
              <X size={18} />
            </Dialog.Close>
          </header>

          <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3 sm:px-6" aria-label="Distributor view">
            {TABS.map(item => (
              <button
                key={item.id}
                type="button"
                aria-pressed={tab === item.id}
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

          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            {tab === "details" ? (
              <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
                <Field label="Owner" value={distributor.owner?.name} />
                <Field label="Owner email" value={distributor.owner?.email} />
                <Field label="Location" value={location} />
                <Field label="Pincode" value={distributor.pincode} />
                <Field label="GST" value={distributor.gstNumber} />
                <Field label="Phone" value={distributor.phone} />
                <Field label="Country" value={distributor.country} />
                <Field label="Kiosks" value={countFormat.format(distributor._count.kiosks)} />
                <Field label="Members" value={countFormat.format(distributor._count.memberships)} />
                <Field
                  label="Status"
                  value={
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        distributor.isActive
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "bg-red-500/10 text-red-700 dark:text-red-300"
                      }`}
                    >
                      {distributor.isActive ? "Active" : "Inactive"}
                    </span>
                  }
                />
              </dl>
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
