import PlaceholderPage from "@/components/common/PlaceholderPage"
import { LifeBuoy } from "lucide-react"

export const metadata = {
  title: "Support · ArcadeLX",
}

export default function SupportPage() {
  return (
    <PlaceholderPage
      title="Support"
      description="Track and resolve tickets across the network."
      icon={<LifeBuoy size={28} />}
      note="This module isn't available yet: the backend endpoint it needs (/api/support) does not exist on this API, so no live data can be shown. It will appear here once that endpoint is in place — no placeholder data is shown in the meantime."
    />
  )
}
