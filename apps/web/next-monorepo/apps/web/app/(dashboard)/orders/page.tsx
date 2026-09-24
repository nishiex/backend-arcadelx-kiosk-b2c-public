import { ShoppingCart } from "lucide-react"
import PlaceholderPage from "@/components/common/PlaceholderPage"

export const metadata = { title: "Orders · ArcadeLX" }

export default function OrdersPage() {
  return (
    <PlaceholderPage
      title="Orders"
      description="Track kiosk orders and fulfilment across the network."
      icon={<ShoppingCart size={28} />}
    />
  )
}
