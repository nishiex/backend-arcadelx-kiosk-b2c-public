import { IndianRupee } from "lucide-react"
import PlaceholderPage from "@/components/common/PlaceholderPage"

export const metadata = { title: "Revenue · ArcadeLX" }

export default function RevenuePage() {
  return (
    <PlaceholderPage
      title="Revenue"
      description="Revenue and share breakdowns across your fleet."
      icon={<IndianRupee size={28} />}
    />
  )
}
