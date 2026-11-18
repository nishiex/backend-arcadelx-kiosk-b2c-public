"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Monitor, Plus, Trash2, X, Check } from "lucide-react"
import { fetchKiosksForIpGame, assignKiosksToIpGame, removeKiosksFromIpGame } from "@/lib/ip-api"
import { fetchKiosks } from "@/lib/backend-api"
import { EmptyState, Skeleton } from "@/components/dashboard/ui"

export default function GameKiosksModal({
  game,
  onClose,
}: {
  game: { id: string; displayName: string; gameIdentifier: string }
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [selectedToAdd, setSelectedToAdd] = useState<string[]>([])
  const [showAddSection, setShowAddSection] = useState(false)

  // Fetch kiosks connected to this specific game
  const connectedKiosksQuery = useQuery({
    queryKey: ["ip-game-kiosks", game.id],
    queryFn: () => fetchKiosksForIpGame(game.id),
  })

  // Fetch all fleet kiosks to allow selecting from
  const allFleetKiosksQuery = useQuery({
    queryKey: ["fleet-kiosks"],
    queryFn: fetchKiosks,
    enabled: showAddSection,
  })

  // Mutation to connect kiosks
  const assignMutation = useMutation({
    mutationFn: (kioskIds: string[]) => assignKiosksToIpGame(game.id, kioskIds),
    onSuccess: (data) => {
      toast.success(
        data.newlyAssigned > 0
          ? `${data.newlyAssigned} kiosk(s) connected to ${game.displayName}`
          : "Selected kiosks were already connected"
      )
      setSelectedToAdd([])
      setShowAddSection(false)
      void queryClient.invalidateQueries({ queryKey: ["ip-game-kiosks", game.id] })
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to connect kiosks")
    },
  })

  // Mutation to disconnect a kiosk
  const removeMutation = useMutation({
    mutationFn: (kioskId: string) => removeKiosksFromIpGame(game.id, [kioskId]),
    onSuccess: () => {
      toast.success("Kiosk disconnected from game")
      void queryClient.invalidateQueries({ queryKey: ["ip-game-kiosks", game.id] })
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to disconnect kiosk")
    },
  })

  const connectedKiosks = connectedKiosksQuery.data?.kiosks ?? []
  const connectedIds = new Set(connectedKiosks.map((k) => k.id))

  const availableFleetKiosks = (allFleetKiosksQuery.data ?? []).filter(
    (kiosk) => !connectedIds.has(kiosk.id)
  )

  const toggleSelectKiosk = (id: string) => {
    setSelectedToAdd((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Monitor className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-lg font-semibold">{game.displayName} · Connected Kiosks</h2>
              <p className="text-xs text-muted-foreground">{game.gameIdentifier}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              Currently connected: <strong>{connectedKiosks.length}</strong>
            </span>
            <button
              type="button"
              onClick={() => setShowAddSection((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              {showAddSection ? "Close Add Panel" : "Connect Kiosks"}
            </button>
          </div>

          {/* Add Section */}
          {showAddSection && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Select fleet kiosks to connect
                </span>
                {selectedToAdd.length > 0 && (
                  <button
                    type="button"
                    disabled={assignMutation.isPending}
                    onClick={() => assignMutation.mutate(selectedToAdd)}
                    className="inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  >
                    <Check className="h-3 w-3" />
                    {assignMutation.isPending
                      ? "Connecting..."
                      : `Connect (${selectedToAdd.length})`}
                  </button>
                )}
              </div>

              {allFleetKiosksQuery.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : availableFleetKiosks.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No other kiosks available in your fleet or all are already connected.
                </p>
              ) : (
                <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                  {availableFleetKiosks.map((kiosk) => {
                    const isSelected = selectedToAdd.includes(kiosk.id)
                    return (
                      <button
                        key={kiosk.id}
                        type="button"
                        onClick={() => toggleSelectKiosk(kiosk.id)}
                        className={`flex flex-col items-start rounded border p-2 text-left transition-colors ${
                          isSelected
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border bg-background hover:bg-muted"
                        }`}
                      >
                        <span className="text-xs font-semibold">{kiosk.machineCode}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {kiosk.model || "Standard"} · {kiosk.status}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Connected Kiosks List */}
          {connectedKiosksQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : connectedKiosks.length === 0 ? (
            <EmptyState message="No kiosks are currently connected to this IP game. Click 'Connect Kiosks' above to assign physical machines." />
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {connectedKiosks.map((kiosk) => (
                <div
                  key={kiosk.id}
                  className="flex items-center justify-between p-3 text-sm transition-colors hover:bg-muted/30"
                >
                  <div className="flex flex-col">
                    <span className="font-semibold text-foreground">{kiosk.machineCode}</span>
                    <span className="text-xs text-muted-foreground">
                      Model: {kiosk.model || "Standard"} · Status: {kiosk.status}
                      {kiosk.currentOrg ? ` · Assigned to: ${kiosk.currentOrg.name}` : ""}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      Connected on: {new Date(kiosk.assignedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <button
                    type="button"
                    title="Disconnect kiosk"
                    disabled={removeMutation.isPending}
                    onClick={() => removeMutation.mutate(kiosk.id)}
                    className="inline-flex items-center gap-1 rounded p-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border p-4 text-right">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
