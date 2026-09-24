"use client"

import React from "react"
import * as RadixDialog from "@radix-ui/react-dialog"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { X, Loader2 } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import {
  updateKioskStatus,
  KIOSK_STATUSES,
  type Kiosk,
  type KioskStatus,
} from "@/lib/backend-api"
import { StatusBadge, STATUS_META } from "@/components/dashboard/ui"

export default function KioskDetailDialog({
  kiosk,
  open,
  onOpenChange,
  canEdit,
  initialStatus,
}: {
  kiosk: Kiosk | null
  open: boolean
  onOpenChange: (v: boolean) => void
  canEdit: boolean
  /** Pre-select a target status when opened (e.g. an inline "Installed" hand-off). */
  initialStatus?: KioskStatus
}) {
  const queryClient = useQueryClient()
  const [status, setStatus] = React.useState<KioskStatus>("AVAILABLE")
  const [location, setLocation] = React.useState("")

  React.useEffect(() => {
    if (kiosk) {
      setStatus(initialStatus ?? kiosk.status)
      setLocation(typeof kiosk.location === "string" ? kiosk.location : "")
    }
  }, [kiosk, initialStatus])

  const mutation = useMutation({
    mutationFn: () =>
      updateKioskStatus(kiosk!.id, {
        status,
        ...(location.trim() ? { location: location.trim() } : {}),
      }),
    onSuccess: () => {
      toast.success("Machine updated")
      queryClient.invalidateQueries({ queryKey: ["kiosks"] })
      queryClient.invalidateQueries({ queryKey: ["inventorySummary"] })
      onOpenChange(false)
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  })

  // Backend requires a location when moving to INSTALLED.
  const needsLocation = status === "INSTALLED" && !location.trim()

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[95%] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-xl">
          {kiosk && (
            <>
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <RadixDialog.Title className="font-mono text-lg font-semibold">
                    {kiosk.machineCode}
                  </RadixDialog.Title>
                  <RadixDialog.Description className="mt-1 text-sm text-muted-foreground">
                    {kiosk.model ?? "Unknown model"}
                  </RadixDialog.Description>
                </div>
                <RadixDialog.Close className="rounded-md p-1 text-muted-foreground hover:bg-muted">
                  <X size={18} />
                </RadixDialog.Close>
              </div>

              <div className="mb-5 grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Current status</p>
                  <div className="mt-1"><StatusBadge status={kiosk.status} /></div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Location</p>
                  <p className="mt-1">{typeof kiosk.location === "string" ? kiosk.location : "—"}</p>
                </div>
              </div>

              {canEdit ? (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="status" className="mb-1.5 block text-sm font-medium">Update status</label>
                    <select
                      id="status"
                      value={status}
                      onChange={(e) => setStatus(e.target.value as KioskStatus)}
                      className={cn(
                        "w-full rounded-lg border border-input px-3 py-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-ring/40",
                        STATUS_META[status]?.pill ?? "bg-background"
                      )}
                    >
                      {KIOSK_STATUSES.map((s) => (
                        <option key={s} value={s}>{STATUS_META[s]?.label ?? s}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="loc" className="mb-1.5 block text-sm font-medium">
                      Location {status === "INSTALLED" && <span className="text-destructive">*</span>}
                    </label>
                    <input
                      id="loc"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="e.g. Phoenix Mall, Mumbai"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring/40"
                    />
                    {needsLocation && (
                      <p className="mt-1 text-xs text-destructive">Location is required to mark a machine Installed.</p>
                    )}
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <RadixDialog.Close className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
                      Cancel
                    </RadixDialog.Close>
                    <button
                      onClick={() => mutation.mutate()}
                      disabled={needsLocation || mutation.isPending}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90",
                        "disabled:cursor-not-allowed disabled:opacity-60"
                      )}
                    >
                      {mutation.isPending && <Loader2 size={16} className="animate-spin" />}
                      Save changes
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  You don't have permission to modify this machine.
                </p>
              )}
            </>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
