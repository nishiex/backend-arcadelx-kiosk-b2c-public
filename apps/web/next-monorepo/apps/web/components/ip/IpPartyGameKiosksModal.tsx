"use client"

import { useQuery } from "@tanstack/react-query"
import { Monitor, X } from "lucide-react"
import { fetchKiosksForIpGame } from "@/lib/ip-api"
import { EmptyState, Skeleton } from "@/components/dashboard/ui"

export default function IpPartyGameKiosksModal({
  game,
  onClose,
}: {
  game: { id: string; displayName: string; gameIdentifier: string }
  onClose: () => void
}) {
  const kiosksQuery = useQuery({
    queryKey: ["ip-game-kiosks", game.id],
    queryFn: () => fetchKiosksForIpGame(game.id),
  })

  const kiosks = kiosksQuery.data?.kiosks ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-border bg-background shadow-2xl">
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
          <div className="text-sm font-medium">
            Total kiosks connected to this game: <strong>{kiosks.length}</strong>
          </div>

          {kiosksQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : kiosksQuery.isError ? (
            <p className="text-sm text-destructive">Could not load kiosks list.</p>
          ) : kiosks.length === 0 ? (
            <EmptyState message="No physical kiosks are currently linked to this game." />
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {kiosks.map((kiosk) => (
                <div
                  key={kiosk.id}
                  className="flex items-center justify-between p-3 text-sm transition-colors hover:bg-muted/30"
                >
                  <div className="flex flex-col">
                    <span className="font-semibold text-foreground">{kiosk.machineCode}</span>
                    <span className="text-xs text-muted-foreground">
                      Model: {kiosk.model || "Standard"} · Status: {kiosk.status}
                    </span>
                    {kiosk.location && (
                      <span className="text-[10px] text-muted-foreground">
                        Location: {kiosk.location}
                      </span>
                    )}
                  </div>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {kiosk.status}
                  </span>
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
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
