import PlaceholderPage from "@/components/common/PlaceholderPage"
import { Wallet } from "lucide-react"

export const metadata = {
  title: "Payments · ArcadeLX",
}

export default function PaymentsPage() {
  return (
    <PlaceholderPage
      title="Payments"
      description="All settlement payments issued to your distributors."
      icon={<Wallet size={28} />}
      note="This module isn't available yet: the backend endpoint it needs (/api/payments) does not exist on this API, so no live data can be shown. It will appear here once that endpoint is in place — no placeholder data is shown in the meantime."
    />
  )
}
