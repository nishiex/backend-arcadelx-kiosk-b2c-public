"use client"

import React from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { useQuery } from "@tanstack/react-query"
import { X } from "lucide-react"
import { fetchKiosks } from "@/lib/backend-api"
import { EmptyState } from "@/components/dashboard/ui"

export default function PartnerViewMoreDialog({
  partner,
  trigger,
}: {
  partner: {
    id: string
    name: string
    state: string | null
    city: string | null
    owner: { id: string; name: string; email: string } | null
    agreementStatus: string | null
    distributorName?: string | null
  }
  trigger: React.ReactElement
}) {
  const [open, setOpen] = React.useState(false)
  const kiosks = useQuery({
    queryKey: ["partner-details-kiosks", partner.id],
    queryFn: fetchKiosks,
    enabled: open,
    staleTime: 10_000,
  })
  const assigned = (kiosks.data ?? []).filter(kiosk => kiosk.currentOrgId === partner.id)

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-xl sm:p-6">
          <Dialog.Close aria-label="Close partner details" className="absolute right-3 top-3 rounded-md p-2 hover:bg-muted"><X size={18} /></Dialog.Close>
          <Dialog.Title className="pr-10 text-xl font-semibold">{partner.name}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">Partner account details and assigned machines.</Dialog.Description>

          <div className="mt-5 grid gap-3 rounded-xl border border-border bg-muted/20 p-4 sm:grid-cols-2">
            <div><p className="text-xs text-muted-foreground">Owner</p><p className="mt-1 text-sm font-medium">{partner.owner?.name ?? "—"}</p><p className="text-xs text-muted-foreground">{partner.owner?.email ?? "—"}</p></div>
            <div><p className="text-xs text-muted-foreground">Location</p><p className="mt-1 text-sm font-medium">{[partner.city, partner.state].filter(Boolean).join(", ") || "—"}</p></div>
            <div><p className="text-xs text-muted-foreground">Distributor</p><p className="mt-1 text-sm font-medium">{partner.distributorName ?? "Direct Company"}</p></div>
            <div><p className="text-xs text-muted-foreground">Agreement</p><p className="mt-1 text-sm font-medium">{partner.agreementStatus?.replaceAll("_", " ") ?? "Not created"}</p></div>
          </div>

          <section className="mt-5 rounded-xl border border-border">
            <div className="border-b border-border px-4 py-3"><h3 className="text-sm font-semibold">Assigned machines</h3></div>
            {kiosks.isLoading ? <p className="p-4 text-sm text-muted-foreground">Loading assigned machines…</p> : kiosks.isError ? <p className="p-4 text-sm text-destructive">Couldn&apos;t load assigned machines.</p> : !assigned.length ? <EmptyState className="py-8" message="No machines are currently assigned to this Partner." /> : (
              <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b border-border text-left text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Machine</th><th className="px-4 py-3 font-medium">Model</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3 font-medium">Location</th></tr></thead><tbody className="divide-y divide-border">{assigned.map(kiosk => <tr key={kiosk.id}><td className="px-4 py-3 font-mono font-medium">{kiosk.machineCode}</td><td className="px-4 py-3">{kiosk.model ?? "—"}</td><td className="px-4 py-3">{kiosk.status.replaceAll("_", " ")}</td><td className="px-4 py-3 text-muted-foreground">{kiosk.location ?? "—"}</td></tr>)}</tbody></table></div>
            )}
          </section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
