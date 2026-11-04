"use client"

import React from "react"
import * as RadixDialog from "@radix-ui/react-dialog"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { X } from "lucide-react"
import { removeKiosk, type Kiosk } from "@/lib/backend-api"
import { useMe } from "@/hooks/useMe"
import { StatusBadge } from "@/components/dashboard/ui"

/**
 * Read-only machine details.
 *
 * This dialog previously offered a Status and Location editor that called
 * `PATCH /api/kiosks/:id/status`. That manual status control is gone: a kiosk's status is
 * now driven entirely by the order lifecycle and by hardware pairing, and the Backend
 * branch removed the same action for the same reason ("all updates are done via Order
 * Lifecycle, hence no manual intervention").
 *
 * Leaving the editor in place was actively harmful after this session's reservation change:
 * a kiosk only becomes reservable while its status is INSTALLED, so a stray manual status
 * change could silently make sellable stock unsellable, or mark unpaired hardware as
 * installed. Status is therefore shown, never edited, here.
 *
 * `canEdit` is still accepted so existing callers do not break, but no write action is
 * offered to anyone.
 */
export default function KioskDetailDialog({
  kiosk,
  open,
  onOpenChange,
  onRemoved,
}: {
  kiosk: Kiosk | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onRemoved?: () => void
  canEdit?: boolean
}) {
  const { orgType, role } = useMe()
  const removeMutation = useMutation({
    mutationFn: () => removeKiosk(kiosk!.id),
    onSuccess: () => {
      toast.success("Kiosk removed from inventory")
      onOpenChange(false)
      onRemoved?.()
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Couldn't remove kiosk"),
  })
  // Only a Distributor retires a machine. A Partner holds kiosks, it does not write them
  // off; asking its supplier to take the machine back is the Partner's route.
  const canDeactivate = orgType === "DISTRIBUTOR" && (role === "OWNER" || role === "ADMIN")
  const canDeactivateStatus = kiosk ? !["RESERVED", "ASSIGNED", "RETIRED"].includes(kiosk.status) : false

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <RadixDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[95%] max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-xl">
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
                <RadixDialog.Close
                  aria-label="Close machine details"
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                >
                  <X size={18} />
                </RadixDialog.Close>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Current status</p>
                  <div className="mt-1">
                    <StatusBadge status={kiosk.status} />
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Location</p>
                  <p className="mt-1">
                    {typeof kiosk.location === "string" ? kiosk.location : "—"}
                  </p>
                </div>
              </div>

              <p className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                Status is managed automatically. A machine becomes INSTALLED when its
                hardware is paired, and changes as orders are reserved, dispatched and
                delivered. It cannot be edited here.
              </p>

              {canDeactivate && (
                <div className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                  <p className="text-xs text-muted-foreground">Deactivate this kiosk while preserving its ownership and assignment history.</p>
                  <button
                    type="button"
                    disabled={!canDeactivateStatus || removeMutation.isPending}
                    onClick={() => {
                      if (window.confirm(`Deactivate ${kiosk.machineCode}? Its ownership and history will be preserved.`)) removeMutation.mutate()
                    }}
                    className="shrink-0 rounded-lg bg-destructive px-3 py-2 text-xs font-semibold text-destructive-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {removeMutation.isPending ? "Deactivating…" : "Deactivate kiosk"}
                  </button>
                </div>
              )}
            </>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
