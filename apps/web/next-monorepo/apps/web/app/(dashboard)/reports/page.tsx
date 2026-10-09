import PlaceholderPage from "@/components/common/PlaceholderPage"
import { FileBarChart } from "lucide-react"

export const metadata = {
  title: "Reports · ArcadeLX",
}

export default function ReportsPage() {
  return (
    <PlaceholderPage
      title="Reports"
      description="Revenue analytics for your distributor network."
      icon={<FileBarChart size={30} />}
      note="This module isn't available yet: the backend endpoint it needs (/api/reports/revenue) does not exist on this API, so no live data can be shown. It will appear here once that endpoint is in place — no placeholder data is shown in the meantime."
    />
  )
}
