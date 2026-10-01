"use client"

import React from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Plus, X } from "lucide-react"
import { createOrder, fetchOrderRequestCompanies, type CreatedOrder } from "@/lib/backend-api"
import { ErrorState } from "@/components/dashboard/ui"

export default function CreateOrderDialog({ organizationId, disabled, onCreated }: {
  organizationId: string
  disabled: boolean
  onCreated: (order: CreatedOrder) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [quantity, setQuantity] = React.useState("1")
  const [selectedCompany, setSelectedCompany] = React.useState("")
  const submitting = React.useRef(false)
  const qc = useQueryClient()
  const companies = useQuery({
    queryKey: ["order-request-companies", organizationId],
    queryFn: ({ signal }) => fetchOrderRequestCompanies(organizationId, signal),
    enabled: open && !disabled,
    staleTime: 0,
    refetchInterval: open ? 30_000 : false,
  })
  const choices = companies.data ?? []
  const targetOrgId = choices.length === 1 ? choices[0]!.id : selectedCompany
  const validQuantity = quantity.trim() !== "" && Number.isInteger(Number(quantity)) && Number(quantity) >= 1 && Number(quantity) <= 50
  const validCompany = choices.some(company => company.id === targetOrgId)
  const mutation = useMutation({
    mutationFn: () => createOrder({ type: "REQUEST", targetOrgId, quantity: Number(quantity) }),
    retry: false,
    onSuccess: order => { setOpen(false); onCreated(order) },
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["orders", organizationId] }),
        qc.invalidateQueries({ queryKey: ["order-request-companies", organizationId] }),
        qc.invalidateQueries({ queryKey: ["workflow-readiness"] }),
      ])
    },
  })
  const blocked = disabled || companies.isFetching || companies.isError || !validCompany || !validQuantity || mutation.isPending
  const changeOpen = (value: boolean) => {
    if (submitting.current) return
    if (value) { setQuantity("1"); setSelectedCompany(""); mutation.reset() }
    setOpen(value)
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger asChild>
        <button type="button" disabled={disabled} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"><Plus size={16} />Request Kiosks</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-xl">
          <Dialog.Title className="pr-7 text-lg font-semibold">Request kiosks</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">Send a request to your company for approval. Your active agreement determines the order amounts.</Dialog.Description>
          <Dialog.Close disabled={mutation.isPending} aria-label="Close kiosk request" className="absolute right-3 top-3 rounded-md p-2 hover:bg-muted"><X size={18} /></Dialog.Close>
          <form className="mt-5 space-y-5" onSubmit={async event => {
            event.preventDefault()
            if (blocked || submitting.current) return
            submitting.current = true
            try { await mutation.mutateAsync() } catch { /* Error is displayed below. */ }
            finally { submitting.current = false }
          }}>
            {disabled && <p role="status" className="text-sm text-muted-foreground">Kiosk requests are temporarily unavailable. Please try again later.</p>}
            {companies.isLoading && <p role="status" className="text-sm text-muted-foreground">Loading your company...</p>}
            {companies.isError ? <ErrorState message="Couldn't load your company relationships." onRetry={() => companies.refetch()} /> : companies.isSuccess && !choices.length ? (
              <p role="status" className="text-sm text-muted-foreground">You need an active company agreement and network connection before requesting kiosks. Contact your company to complete setup.</p>
            ) : choices.length > 0 && (
              <label className="block space-y-2 text-sm font-medium">Company
                <select aria-label="Company" value={targetOrgId} disabled={mutation.isPending || disabled} onChange={event => setSelectedCompany(event.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2.5">
                  {choices.length > 1 && <option value="">Select a company</option>}
                  {choices.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
                </select>
              </label>
            )}
            <label className="block space-y-2 text-sm font-medium">Quantity
              <input aria-label="Quantity" aria-invalid={!validQuantity} aria-describedby="request-quantity-hint" type="number" min={1} max={50} step={1} required value={quantity} disabled={mutation.isPending || disabled} onChange={event => setQuantity(event.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2.5" />
            </label>
            <p id="request-quantity-hint" className={`text-sm ${validQuantity ? "text-muted-foreground" : "text-destructive"}`}>Enter a whole number from 1 to 50.</p>
            {mutation.isError && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
            <div className="flex justify-end gap-3">
              <Dialog.Close disabled={mutation.isPending} className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">Cancel</Dialog.Close>
              <button type="submit" disabled={blocked} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{mutation.isPending && <Loader2 size={16} className="animate-spin" />}{mutation.isPending ? "Submitting..." : "Submit request"}</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
