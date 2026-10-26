"use client"

import React from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Building2, RefreshCw, UsersRound } from "lucide-react"
import { toast } from "sonner"
import { useMe } from "@/hooks/useMe"
import { assignKiosks, fetchDistributors, fetchKiosks, fetchPartners } from "@/lib/backend-api"
import AddPartnerForm from "./AddPartnerForm"
import PartnerAgreementDialog from "./PartnerAgreementDialog"
import { EmptyState, ErrorState, Skeleton } from "@/components/dashboard/ui"

const buttonClass = "rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"

function SendKiosksDialog({ partner }: { partner: { id: string; name: string; agreementStatus?: string | null } }) {
  const { me } = useMe()
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [selected, setSelected] = React.useState<string[]>([])
  const organizationId = me?.membership?.organizationId
  const kiosks = useQuery({
    queryKey: ["partner-transfer-kiosks", organizationId],
    queryFn: fetchKiosks,
    enabled: open && !!organizationId,
    staleTime: 0,
  })
  const transfer = useMutation({
    mutationFn: () => assignKiosks({ organizationId: partner.id, kioskIds: selected }),
    onSuccess: () => {
      toast.success(`Kiosk${selected.length === 1 ? "" : "s"} sent to ${partner.name}`)
      setSelected([])
      setOpen(false)
      void queryClient.invalidateQueries({ queryKey: ["partners", organizationId] })
      void queryClient.invalidateQueries({ queryKey: ["kiosks"] })
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const available = (kiosks.data ?? []).filter(kiosk =>
    kiosk.currentOrgId === organizationId &&
    ["AVAILABLE", "RETURNED", "MAINTENANCE"].includes(kiosk.status),
  )
  const canSendKiosks = partner.agreementStatus === "ACTIVE"

  function change(next: boolean) {
    if (next) {
      setSelected([])
      kiosks.refetch()
    }
    setOpen(next)
  }

  return (
    <Dialog.Root open={open} onOpenChange={change}>
      <Dialog.Trigger asChild>
        <button type="button" className={buttonClass} disabled={!organizationId}>
          Send kiosks
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-xl sm:p-6">
          <Dialog.Title className="text-xl font-semibold">Send kiosks to {partner.name}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            Select available kiosks from your Distributor inventory to transfer to this Partner.
          </Dialog.Description>
          <div className="mt-5 space-y-3">
            {kiosks.isLoading ? (
              <p role="status" className="text-sm text-muted-foreground">Loading available kiosks…</p>
            ) : kiosks.isError ? (
              <p role="alert" className="text-sm text-destructive">Couldn’t load your available kiosks. Close and try again.</p>
            ) : !available.length ? (
              <p className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">No available kiosks are currently in your inventory.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
                {available.map(kiosk => {
                  const checked = selected.includes(kiosk.id)
                  return (
                    <label key={kiosk.id} className={`flex cursor-pointer items-center gap-3 border-b border-border px-3 py-3 last:border-0 ${checked ? "bg-primary/5" : ""}`}>
                      <input type="checkbox" aria-label={`Select ${kiosk.machineCode}`} checked={checked} onChange={() => setSelected(ids => checked ? ids.filter(id => id !== kiosk.id) : [...ids, kiosk.id])} />
                      <span className="font-mono text-sm font-medium">{kiosk.machineCode}</span>
                      <span className="text-sm text-muted-foreground">{kiosk.model ?? "Unknown model"} · {kiosk.status.replaceAll("_", " ")}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild><button type="button" className={buttonClass} disabled={transfer.isPending}>Cancel</button></Dialog.Close>
            {!canSendKiosks && <p className="mr-auto text-xs text-amber-700 dark:text-amber-300">Approve the Partner agreement before sending kiosks.</p>}
            <button type="button" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={!selected.length || transfer.isPending || !canSendKiosks} onClick={() => transfer.mutate()}>
              {transfer.isPending ? "Sending…" : `Send${selected.length ? ` (${selected.length})` : ""}`}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default function PartnersScreen() {
  const { canViewPartners, canRegisterPartners, canManageDistributors, canManageAgreements, isCompany, isMasterAdmin, isLoading, me } = useMe()
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
  const directCompanyRows = isCompany
    ? (partners.data ?? []).map(partner => ({ ...partner, distributorName: null }))
    : []
  const rows = isCompany
    ? [...directCompanyRows, ...companyRows.filter(row => !directCompanyRows.some(direct => direct.id === row.id))]
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
                  {(isMasterAdmin || !isCompany) && <th className="px-3 py-3 text-right font-medium">Actions</th>}
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
                    {(isMasterAdmin || !isCompany) && <td className="px-3 py-3 text-right"><div className="flex flex-wrap justify-end gap-2">{canManageAgreements && organizationId && <PartnerAgreementDialog partner={partner} organizationId={organizationId} />}{!isCompany && <SendKiosksDialog partner={partner} />}</div></td>}
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
