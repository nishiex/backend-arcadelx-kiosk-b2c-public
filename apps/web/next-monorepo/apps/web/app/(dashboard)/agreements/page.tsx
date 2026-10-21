import { Suspense } from "react"
import AgreementsScreen from "@/components/agreements/AgreementsScreen"
import { Skeleton } from "@/components/dashboard/ui"

export const metadata = {
  title: "Agreements · ArcadeLX",
}

export default function AgreementsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <AgreementsScreen />
    </Suspense>
  )
}
