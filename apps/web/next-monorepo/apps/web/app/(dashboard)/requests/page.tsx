import { Suspense } from "react"
import RequestsScreen from "@/components/requests/RequestsScreen"
import { Skeleton } from "@/components/dashboard/ui"

export const metadata = {
  title: "Requests · ArcadeLX",
}

export default function RequestsPage() {
  // RequestsScreen reads `?tab=` so the sidebar can deep-link each section; the
  // Suspense boundary keeps the rest of the route prerenderable.
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <RequestsScreen />
    </Suspense>
  )
}
