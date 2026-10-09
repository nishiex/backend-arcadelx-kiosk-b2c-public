import PlaceholderPage from "@/components/common/PlaceholderPage"
import { Receipt } from "lucide-react"

export const metadata = {
  title: "Settlements · ArcadeLX",
}

export default function SettlementsPage() {
  return (
    <PlaceholderPage
      title="Settlements"
      description="Monthly revenue-share payout runs across your distributor network."
      icon={<Receipt size={28} />}
      note="This module isn't available yet: the backend endpoint it needs (/api/settlements) does not exist on this API, so no live data can be shown. It will appear here once that endpoint is in place — no placeholder data is shown in the meantime."
    />
  )
}
