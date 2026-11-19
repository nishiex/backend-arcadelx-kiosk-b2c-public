"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  downloadMyIpSettlement,
  fetchMyIpDailyRevenue,
  fetchMyIpGames,
  fetchMyIpSettlements,
  type IpGame,
  type IpSettlement,
} from "@/lib/ip-api"
import IpStudioView, { IpStudioError, IpStudioLoading } from "./IpStudioView"
import IpPartyGameKiosksModal from "./IpPartyGameKiosksModal"

export default function IpPartyDashboard() {
  const [selectedGame, setSelectedGame] = useState<IpGame | null>(null)
  const games = useQuery({ queryKey: ["ip-my-games"], queryFn: fetchMyIpGames })
  const revenue = useQuery({ queryKey: ["ip-daily-revenue"], queryFn: () => fetchMyIpDailyRevenue() })
  const settlements = useQuery({ queryKey: ["ip-settlements"], queryFn: () => fetchMyIpSettlements() })

  async function downloadSettlement(settlement: IpSettlement) {
    try {
      const blob = await downloadMyIpSettlement(settlement.id)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `settlement-${settlement.year}-${settlement.month}.pdf`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't download the statement")
    }
  }

  if (games.isLoading || revenue.isLoading || settlements.isLoading) return <IpStudioLoading />

  if (games.isError || revenue.isError || settlements.isError || !revenue.data) {
    return (
      <IpStudioError
        onRetry={() => {
          void games.refetch()
          void revenue.refetch()
          void settlements.refetch()
        }}
      />
    )
  }

  return (
    <>
      <IpStudioView
        games={games.data ?? []}
        daily={revenue.data}
        settlements={settlements.data ?? []}
        onOpenKiosks={setSelectedGame}
        onDownloadSettlement={settlement => void downloadSettlement(settlement)}
      />
      {selectedGame && (
        <IpPartyGameKiosksModal game={selectedGame} onClose={() => setSelectedGame(null)} />
      )}
    </>
  )
}
