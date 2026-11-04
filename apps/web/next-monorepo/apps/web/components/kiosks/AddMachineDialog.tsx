"use client"

import React from "react"
import * as RadixDialog from "@radix-ui/react-dialog"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus, X, Loader2 } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { createKioskBatch } from "@/lib/backend-api"
import { KIOSK_MODELS } from "@/lib/kiosk-models"

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      {children}
    </div>
  )
}

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"

/**
 * Minting always creates unpaired machines, so the inventory has to widen its filter
 * afterwards or the operator closes the dialog to an unchanged list.
 */
export default function AddMachineDialog({ onMinted }: { onMinted?: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [model, setModel] = React.useState<string>(KIOSK_MODELS[0])
  const [count, setCount] = React.useState(1)
  const queryClient = useQueryClient()

  // Reset the form each time the dialog opens.
  React.useEffect(() => {
    if (open) {
      setModel(KIOSK_MODELS[0])
      setCount(1)
    }
  }, [open])

  const mutation = useMutation({
    mutationFn: () => createKioskBatch({ count, model }),
    onSuccess: (data) => {
      toast.success(
        data.count > 1
          ? `Minted ${data.count} machines (${data.startCode} – ${data.endCode})`
          : `Minted ${data.startCode}`
      )
      queryClient.invalidateQueries({ queryKey: ["kiosks"] })
      queryClient.invalidateQueries({ queryKey: ["inventorySummary"] })
      onMinted?.()
      setOpen(false)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to mint machines"),
  })

  const valid = model.trim().length > 0 && count >= 1 && count <= 100

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Trigger asChild>
        <button className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90">
          <Plus size={16} /> Add Machine
        </button>
      </RadixDialog.Trigger>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[95%] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl">
          <div className="mb-5 flex items-center justify-between">
            <RadixDialog.Title className="text-lg font-semibold">Mint Machines</RadixDialog.Title>
            <RadixDialog.Close className="rounded-md p-1 text-muted-foreground hover:bg-muted">
              <X size={18} />
            </RadixDialog.Close>
          </div>

          <div className="mb-4 rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-xs text-muted-foreground">
              Machine codes are generated server-side and guaranteed unique. Pick a model and how
              many units to mint into your inventory.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Machine Model">
              <select className={inputCls} value={model} onChange={(e) => setModel(e.target.value)}>
                {KIOSK_MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </Field>
            <Field label="Quantity (1–100)">
              <input
                type="number"
                min={1}
                max={100}
                className={inputCls}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
              />
            </Field>
          </div>

          <div className="mt-6 flex justify-end gap-2 border-t border-border pt-5">
            <RadixDialog.Close className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
              Cancel
            </RadixDialog.Close>
            <button
              onClick={() => mutation.mutate()}
              disabled={!valid || mutation.isPending}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90",
                "disabled:cursor-not-allowed disabled:opacity-60"
              )}
            >
              {mutation.isPending && <Loader2 size={16} className="animate-spin" />}
              {count > 1 ? `Mint ${count} Machines` : "Mint Machine"}
            </button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
