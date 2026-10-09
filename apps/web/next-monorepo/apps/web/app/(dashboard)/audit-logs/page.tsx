import PlaceholderPage from "@/components/common/PlaceholderPage"
import { ScrollText } from "lucide-react"

export const metadata = {
  title: "Audit Logs · ArcadeLX",
}

export default function AuditLogsPage() {
  return (
    <PlaceholderPage
      title="Audit Logs"
      description="A record of every write action across the network — who did what, and when."
      icon={<ScrollText size={28} />}
      note="This module isn't available yet: the backend endpoint it needs (/api/audit-logs) does not exist on this API, so no live data can be shown. It will appear here once that endpoint is in place — no placeholder data is shown in the meantime."
    />
  )
}
