"use client"

import React from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { useQuery } from "@tanstack/react-query"
import { Building2, Eye, RefreshCw, Search, UsersRound } from "lucide-react"
import { useMe } from "@/hooks/useMe"
import { fetchDistributors, fetchKiosks, fetchPartners } from "@/lib/backend-api"
import AddPartnerForm from "./AddPartnerForm"
import PartnerAgreementDialog from "./PartnerAgreementDialog"
import PartnerViewMoreDialog from "./PartnerViewMoreDialog"
import { EmptyState, ErrorState, Skeleton } from "@/components/dashboard/ui"
import { useReveal } from "@/hooks/useReveal"

const buttonClass = "rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"

function PartnerKiosksDialog({ partner }: { partner: { id: string; name: string } }) {
  const [open, setOpen] = React.useState(false)
  const kiosks = useQuery({
    queryKey: ["partner-kiosks", partner.id],
    queryFn: fetchKiosks,
    enabled: open,
    staleTime: 10_000,
  })
  const assigned = (kiosks.data ?? []).filter(kiosk => kiosk.currentOrgId === partner.id)

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className={buttonClass}><Eye size={14} className="mr-1 inline" />Machines</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-xl sm:p-6">
          <Dialog.Title className="text-xl font-semibold">Machines assigned to {partner.name}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">Machines currently held by this Partner.</Dialog.Description>
          {kiosks.isLoading ? (
            <p role="status" className="mt-5 text-sm text-muted-foreground">Loading assigned machines…</p>
          ) : kiosks.isError ? (
            <p role="alert" className="mt-5 text-sm text-destructive">Couldn’t load this Partner&apos;s machines.</p>
          ) : !assigned.length ? (
            <p className="mt-5 rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">No machines are currently assigned to this Partner.</p>
          ) : (
            <div className="mt-5 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs text-muted-foreground"><tr><th className="px-3 py-3 font-medium">Machine code</th><th className="px-3 py-3 font-medium">Model</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 font-medium">Location</th></tr></thead>
                <tbody className="divide-y divide-border">{assigned.map(kiosk => <tr key={kiosk.id}><td className="px-3 py-3 font-mono font-medium">{kiosk.machineCode}</td><td className="px-3 py-3">{kiosk.model ?? "—"}</td><td className="px-3 py-3">{kiosk.status.replaceAll("_", " ")}</td><td className="px-3 py-3 text-muted-foreground">{kiosk.location ?? "—"}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          <div className="mt-5 flex justify-end"><Dialog.Close asChild><button type="button" className={buttonClass}>Close</button></Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default function PartnersScreen() {
  const { canViewPartners, canRegisterPartners, canManageDistributors, canManageAgreements, isCompany, isMasterAdmin, isLoading, me } = useMe()
  const [scope, setScope] = React.useState<"company" | "distributor">("company")
  const [search, setSearch] = React.useState("")
  const organizationId = me?.membership?.organizationId
  const partners = useQuery({
    queryKey: ["partners", organizationId],
    queryFn: fetchPartners,
    enabled: canViewPartners && !!organizationId,
    staleTime: 30_000,
    retry: 1,
  })
  const distributors = useQuery({
    queryKey: ["distributors", organizationId, "partners"],
    queryFn: fetchDistributors,
    enabled: isCompany && canManageDistributors,
    staleTime: 30_000,
    retry: 1,
  })
  const allKiosks = useQuery({
    queryKey: ["partner-search-kiosks", organizationId],
    queryFn: fetchKiosks,
    enabled: canViewPartners && !!organizationId,
    staleTime: 10_000,
  })

  if (isLoading) return <p role="status" className="text-sm text-muted-foreground">Loading partners…</p>
  if (!canViewPartners && !(isCompany && canManageDistributors)) {
    return <p role="alert" className="text-sm text-muted-foreground">You don’t have permission to view partners.</p>
  }

  const companyRows = (distributors.data ?? []).flatMap(distributor =>
    (distributor.partners ?? []).map(partner => ({
      ...partner,
      distributorName: distributor.name,
      agreementStatus: partner.agreementStatus,
    })),
  )
  const directCompanyRows = isCompany
    ? (partners.data ?? []).map(partner => ({ ...partner, distributorName: null }))
    : []
  const rows = isCompany
    ? (scope === "company" ? directCompanyRows : companyRows)
    : (partners.data ?? []).map(partner => ({
        ...partner,
        distributorName: null,
      }))
  const query = search.trim().toLowerCase()
  const kioskMatches = new Map<string, string>()
  for (const kiosk of allKiosks.data ?? []) {
    const match = [kiosk.machineCode, kiosk.model ?? ""].join(" ").toLowerCase().includes(query)
    if (match && kiosk.currentOrgId) kioskMatches.set(kiosk.currentOrgId, kiosk.machineCode)
  }
  const filteredRows = !query ? rows : rows.filter(partner =>
    [partner.name, partner.owner?.email ?? "", partner.distributorName ?? ""].join(" ").toLowerCase().includes(query) || kioskMatches.has(partner.id),
  )
  const bodyRef = useReveal<HTMLTableSectionElement>([filteredRows.length])

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Partners</h1>
          <p className="mt-1 text-sm text-muted-foreground">View partners registered under or connected to your distributor account.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className={`${buttonClass} inline-flex items-center gap-2`} onClick={() => void partners.refetch()} disabled={partners.isFetching}>
            <RefreshCw size={15} className={partners.isFetching ? "animate-spin" : ""} /> Refresh
          </button>
          {canRegisterPartners && <AddPartnerForm modal />}
        </div>
      </div>
      {isCompany && (
        <div className="flex flex-wrap gap-2" aria-label="Partner scope">
          <button type="button" aria-pressed={scope === "company"} onClick={() => setScope("company")} className={`rounded-lg border px-4 py-2 text-sm font-medium ${scope === "company" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"}`}>
            Company Partners ({directCompanyRows.length})
          </button>
          <button type="button" aria-pressed={scope === "distributor"} onClick={() => setScope("distributor")} className={`rounded-lg border px-4 py-2 text-sm font-medium ${scope === "distributor" ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"}`}>
            Distributor Partners ({companyRows.length})
          </button>
        </div>
      )}
      <label className="relative block max-w-xl"><Search size={16} className="pointer-events-none absolute left-3 top-2.5 text-muted-foreground" /><input className="w-full rounded-lg border border-border bg-card px-3 py-2 pl-9 text-sm outline-none focus:border-primary" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search partner, machine code, or kiosk model" aria-label="Search partners, machine code, or kiosk model" /></label>
      <section aria-labelledby="partner-list-title" className="rounded-xl border border-border bg-card">
        <div className="flex items-center gap-3 border-b border-border p-4 sm:p-6">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Building2 size={19} aria-hidden="true" /></span>
          <div>
            <h2 id="partner-list-title" className="font-semibold">{isCompany ? scope === "company" ? "Company Partners" : "Distributor Partners" : "Partners"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isCompany
                ? scope === "company" ? "Partners connected directly under your Company are shown." : "Partners operating under your Distributor network are shown."
                : "Partners registered under or connected to this Distributor are shown."}
            </p>
          </div>
        </div>
        {(isCompany ? distributors.isLoading : partners.isLoading) ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 5 }).map((_, index) => <div key={index} className="flex items-center gap-4 p-4"><Skeleton className="h-9 w-9 rounded-full" /><Skeleton className="h-9 flex-1" /><Skeleton className="h-5 w-24" /></div>)}
          </div>
        ) : (isCompany ? distributors.isError : partners.isError) ? (
          <ErrorState message="Couldn’t load partners." onRetry={() => void (isCompany ? distributors.refetch() : partners.refetch())} />
        ) : !filteredRows.length ? (
          <EmptyState className="py-10" icon={<UsersRound size={28} />} message={query ? "No partners or kiosks match this search." : "No connected partners yet."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Business</th>
                  {isCompany && <th className="px-3 py-3 font-medium">Distributor</th>}
                  <th className="px-3 py-3 font-medium">Location</th>
                  <th className="px-3 py-3 font-medium">Agreement</th>
                  {(isMasterAdmin || !isCompany) && <th className="px-4 py-3 text-right font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody ref={bodyRef} className="divide-y divide-border">
                {filteredRows.map((partner) => (
                  <tr key={partner.id} data-reveal className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/40">
                    <th scope="row" className="px-4 py-3 text-left">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{partner.name.slice(0, 2).toUpperCase()}</span>
                        <PartnerViewMoreDialog
                          partner={partner}
                          trigger={<button type="button" className="min-w-0 text-left focus-visible:outline-2 focus-visible:outline-ring" aria-label={`Open ${partner.name}`}><span className="block truncate font-medium hover:underline">{partner.name}</span><span className="block truncate text-xs text-muted-foreground">{partner.owner?.email ?? "No owner"}</span></button>}
                        />
                      </div>
                    </th>
                    {isCompany && <td className="px-3 py-3 text-muted-foreground">{partner.distributorName ?? "Direct Company"}</td>}
                    <td className="px-3 py-3 text-muted-foreground">{[partner.city, partner.state].filter(Boolean).join(", ") || "—"}</td>
                    <td className="px-3 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${partner.agreementStatus === "ACTIVE" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : partner.agreementStatus === "PENDING_APPROVAL" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}>{partner.agreementStatus?.replaceAll("_", " ") ?? "Not created"}</span></td>
                {(isMasterAdmin || !isCompany) && <td className="px-4 py-3 text-right"><div className="flex flex-wrap justify-end gap-2"><PartnerKiosksDialog partner={partner} />{canManageAgreements && organizationId && <PartnerAgreementDialog partner={partner} organizationId={organizationId} />}</div></td>}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">{filteredRows.length} partner{filteredRows.length === 1 ? "" : "s"}</div>
          </div>
        )}
      </section>
    </div>
  )
}
