"use client"

import { useQuery } from "@tanstack/react-query"
import { Building2, RefreshCw, UsersRound } from "lucide-react"
import { useMe } from "@/hooks/useMe"
import { fetchDistributors, fetchPartners } from "@/lib/backend-api"
import AddPartnerForm from "./AddPartnerForm"
import { EmptyState, ErrorState, Skeleton } from "@/components/dashboard/ui"

const buttonClass = "rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"

export default function PartnersScreen() {
  const { canViewPartners, canRegisterPartners, canManageDistributors, isCompany, isLoading, me } = useMe()
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

  if (isLoading) return <p role="status" className="text-sm text-muted-foreground">Loading partners…</p>
  if (!canViewPartners && !(isCompany && canManageDistributors)) {
    return <p role="alert" className="text-sm text-muted-foreground">You don’t have permission to view partners.</p>
  }

  const companyRows = (distributors.data ?? []).flatMap(distributor =>
    (distributor.partners ?? []).map(partner => ({
      ...partner,
      distributorName: distributor.name,
      agreementStatus: null,
    })),
  )
  const rows = isCompany
    ? companyRows
    : (partners.data ?? []).map(partner => ({
        ...partner,
        distributorName: null,
      }))

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Partners</h1>
          <p className="mt-1 text-sm text-muted-foreground">View partners registered under or connected to your distributor account.</p>
        </div>
        <button type="button" className={`${buttonClass} inline-flex items-center gap-2`} onClick={() => void partners.refetch()} disabled={partners.isFetching}>
          <RefreshCw size={15} className={partners.isFetching ? "animate-spin" : ""} /> Refresh
        </button>
      </div>
      <section aria-labelledby="partner-list-title" className="rounded-xl border border-border bg-card p-6 sm:p-8">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Building2 size={22} aria-hidden="true" /></span>
          <div>
            <h2 id="partner-list-title" className="text-lg font-semibold">Registered and connected partners</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isCompany
                ? "Partners associated with each distributor in your network are shown."
                : "Partners registered under or connected to this Distributor are shown."}
            </p>
          </div>
        </div>
        {(isCompany ? distributors.isLoading : partners.isLoading) ? (
          <div className="space-y-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
        ) : (isCompany ? distributors.isError : partners.isError) ? (
          <ErrorState message="Couldn’t load partners." onRetry={() => void (isCompany ? distributors.refetch() : partners.refetch())} />
        ) : !rows.length ? (
          <EmptyState className="py-10" icon={<UsersRound size={28} />} message="No connected partners yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-3 py-3 font-medium">Business</th>
                  {isCompany && <th className="px-3 py-3 font-medium">Distributor</th>}
                  <th className="px-3 py-3 font-medium">Owner</th>
                  <th className="px-3 py-3 font-medium">Location</th>
                  <th className="px-3 py-3 font-medium">Agreement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((partner) => (
                  <tr key={partner.id} className="hover:bg-muted/40">
                    <th scope="row" className="px-3 py-3 text-left font-medium">{partner.name}</th>
                    {isCompany && <td className="px-3 py-3">{partner.distributorName}</td>}
                    <td className="px-3 py-3">{partner.owner?.email ?? "—"}</td>
                    <td className="px-3 py-3 text-muted-foreground">{[partner.city, partner.state].filter(Boolean).join(", ") || "—"}</td>
                    <td className="px-3 py-3 text-muted-foreground">{partner.agreementStatus?.replaceAll("_", " ") ?? "Not created"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {canRegisterPartners && (
      <section aria-labelledby="partner-registration-title" className="rounded-xl border border-border bg-card p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><UsersRound size={22} aria-hidden="true" /></span>
            <div>
              <h2 id="partner-registration-title" className="text-lg font-semibold">Partner registration</h2>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">Add the business details and owner’s email address. The owner will receive login credentials for their Partner dashboard.</p>
            </div>
          </div>
          <div className="shrink-0"><AddPartnerForm modal /></div>
        </div>
      </section>
      )}
    </div>
  )
}
