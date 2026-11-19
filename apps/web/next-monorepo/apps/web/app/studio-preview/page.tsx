"use client"

import IpStudioShell from "@/components/ip/IpStudioShell"
import IpStudioView from "@/components/ip/IpStudioView"
import type { IpDailyRevenue, IpGame, IpSettlement } from "@/lib/ip-api"

// TEMPORARY design preview — deleted before commit.
const games: IpGame[] = [
  { id: "1", organizationId: "o", gameIdentifier: "neon-drift", displayName: "Neon Drift", coverImageUrl: null, launchDate: null, status: "ACTIVE", createdAt: "" },
  { id: "2", organizationId: "o", gameIdentifier: "sky-raider", displayName: "Sky Raider", coverImageUrl: null, launchDate: null, status: "ACTIVE", createdAt: "" },
  { id: "3", organizationId: "o", gameIdentifier: "pixel-quest", displayName: "Pixel Quest", coverImageUrl: null, launchDate: null, status: "PAUSED", createdAt: "" },
]

const daily: IpDailyRevenue = {
  businessDate: "2026-11-18",
  timezone: "Asia/Kolkata",
  summary: { totalGrossRevenue: "184250.00", totalIpRoyaltyShare: "36850.00", totalKioskCount: 46, totalGames: 3 },
  games: [
    { gameId: "1", gameIdentifier: "neon-drift", displayName: "Neon Drift", kioskCount: 22, grossRevenue: "98400.00", ipRoyaltyShare: "19680.00" },
    { gameId: "2", gameIdentifier: "sky-raider", displayName: "Sky Raider", kioskCount: 16, grossRevenue: "61850.00", ipRoyaltyShare: "12370.00" },
    { gameId: "3", gameIdentifier: "pixel-quest", displayName: "Pixel Quest", kioskCount: 8, grossRevenue: "24000.00", ipRoyaltyShare: "4800.00" },
  ],
  aggregationStatus: "COMPLETED",
  globalJobStatus: "COMPLETED",
}

const settlements: IpSettlement[] = [
  { id: "s1", month: 10, year: 2026, grossRevenue: "5120000.00", ipRoyaltyShare: "1024000.00", finalPayout: "1012500.00", totalKioskCount: 44, status: "PAID", hasPdf: true, emailDeliveredAt: null, createdAt: "", linesCount: 3 },
  { id: "s2", month: 9, year: 2026, grossRevenue: "4380000.00", ipRoyaltyShare: "876000.00", finalPayout: "864000.00", totalKioskCount: 39, status: "PAID", hasPdf: true, emailDeliveredAt: null, createdAt: "", linesCount: 3 },
]

export default function StudioPreviewPage() {
  return (
    <IpStudioShell>
      <IpStudioView
        games={games}
        daily={daily}
        settlements={settlements}
        onOpenKiosks={() => {}}
        onDownloadSettlement={() => {}}
      />
    </IpStudioShell>
  )
}
