// ─── Mock Data Layer ────────────────────────────────────────────────────────
// Replace individual fetch* calls with real API functions to wire live data.

export type KPIMetric = {
  id: string
  label: string
  value: number
  prefix?: string
  suffix?: string
  change: number   // percentage, positive = up
  trend: "up" | "down"
  sparkline: { v: number }[]
}

export type RevenuePoint = {
  date: string
  current: number
  previous: number
}

export type OrderPoint = {
  day: string
  orders: number
  returns: number
}

export type TrafficSource = {
  name: string
  value: number
  color: string
}

export type PerformanceMetric = {
  label: string
  value: number
  unit: string
  target: number
  status: "good" | "warning" | "critical"
}

export type SystemService = {
  name: string
  status: "operational" | "degraded" | "outage"
  uptime: number
}

export type ActivityItem = {
  id: string
  type: "order" | "signup" | "payment" | "alert" | "system"
  title: string
  description: string
  timestamp: string
  status: "success" | "warning" | "error" | "info"
}

export type Order = {
  id: string
  customer: string
  email: string
  product: string
  amount: number
  status: "completed" | "processing" | "pending" | "cancelled"
  date: string
}

export type TopProduct = {
  rank: number
  name: string
  category: string
  revenue: number
  units: number
  percentage: number
}

// ── KPIs ────────────────────────────────────────────────────────────────────
export const mockKPIs: KPIMetric[] = [
  {
    id: "revenue",
    label: "Total Revenue",
    value: 248350,
    prefix: "$",
    change: 12.4,
    trend: "up",
    sparkline: [
      { v: 180000 }, { v: 195000 }, { v: 210000 }, { v: 205000 },
      { v: 220000 }, { v: 235000 }, { v: 248350 },
    ],
  },
  {
    id: "orders",
    label: "Total Orders",
    value: 3842,
    change: 8.1,
    trend: "up",
    sparkline: [
      { v: 3100 }, { v: 3250 }, { v: 3400 }, { v: 3320 },
      { v: 3550 }, { v: 3700 }, { v: 3842 },
    ],
  },
  {
    id: "customers",
    label: "New Customers",
    value: 1274,
    change: -2.3,
    trend: "down",
    sparkline: [
      { v: 1400 }, { v: 1380 }, { v: 1350 }, { v: 1320 },
      { v: 1300 }, { v: 1280 }, { v: 1274 },
    ],
  },
  {
    id: "conversion",
    label: "Conversion Rate",
    value: 3.68,
    suffix: "%",
    change: 0.4,
    trend: "up",
    sparkline: [
      { v: 3.1 }, { v: 3.2 }, { v: 3.4 }, { v: 3.3 },
      { v: 3.5 }, { v: 3.6 }, { v: 3.68 },
    ],
  },
]

// ── Revenue Analytics ────────────────────────────────────────────────────────
function generateRevenue(days: number): RevenuePoint[] {
  const pts: RevenuePoint[] = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    pts.push({
      date: label,
      current: Math.round(5000 + Math.random() * 12000 + (days - i) * 80),
      previous: Math.round(4000 + Math.random() * 10000 + (days - i) * 60),
    })
  }
  return pts
}

export const revenueData: Record<"7d" | "30d" | "90d", RevenuePoint[]> = {
  "7d": generateRevenue(7),
  "30d": generateRevenue(30),
  "90d": generateRevenue(90),
}

// ── Orders Analytics ─────────────────────────────────────────────────────────
export const ordersData: OrderPoint[] = [
  { day: "Mon", orders: 420, returns: 18 },
  { day: "Tue", orders: 380, returns: 22 },
  { day: "Wed", orders: 510, returns: 15 },
  { day: "Thu", orders: 470, returns: 28 },
  { day: "Fri", orders: 620, returns: 20 },
  { day: "Sat", orders: 580, returns: 12 },
  { day: "Sun", orders: 350, returns: 8 },
]

// ── Traffic Sources ──────────────────────────────────────────────────────────
export const trafficSources: TrafficSource[] = [
  { name: "Organic Search", value: 38.4, color: "#3b82f6" },
  { name: "Direct", value: 24.1, color: "#8b5cf6" },
  { name: "Social Media", value: 18.7, color: "#10b981" },
  { name: "Referral", value: 12.3, color: "#f59e0b" },
  { name: "Email", value: 6.5, color: "#ef4444" },
]

// ── Performance Metrics ──────────────────────────────────────────────────────
export const performanceMetrics: PerformanceMetric[] = [
  { label: "API Response Time", value: 142, unit: "ms", target: 200, status: "good" },
  { label: "Request Volume", value: 94.2, unit: "k/hr", target: 120, status: "good" },
  { label: "Success Rate", value: 99.7, unit: "%", target: 99, status: "good" },
  { label: "Error Rate", value: 0.3, unit: "%", target: 1, status: "good" },
]

// ── System Health ────────────────────────────────────────────────────────────
export const systemServices: SystemService[] = [
  { name: "API Gateway", status: "operational", uptime: 99.99 },
  { name: "Database", status: "operational", uptime: 99.97 },
  { name: "Payment Service", status: "operational", uptime: 100 },
  { name: "Auth Service", status: "operational", uptime: 99.98 },
  { name: "File Storage", status: "degraded", uptime: 98.42 },
]

// ── Recent Activity ──────────────────────────────────────────────────────────
export const recentActivity: ActivityItem[] = [
  { id: "a1", type: "order", title: "New order placed", description: "Order #10491 by Sarah Johnson — $249.00", timestamp: "2 min ago", status: "success" },
  { id: "a2", type: "signup", title: "New customer registered", description: "alex.turner@example.com joined via referral", timestamp: "14 min ago", status: "info" },
  { id: "a3", type: "payment", title: "Payment failed", description: "Order #10488 — Stripe declined card", timestamp: "31 min ago", status: "error" },
  { id: "a4", type: "alert", title: "File Storage degraded", description: "Latency spike detected on storage cluster", timestamp: "1 hr ago", status: "warning" },
  { id: "a5", type: "payment", title: "Refund processed", description: "Order #10480 — $89.00 refunded to customer", timestamp: "2 hr ago", status: "info" },
  { id: "a6", type: "system", title: "System update deployed", description: "API v2.4.1 deployed successfully to production", timestamp: "4 hr ago", status: "success" },
]

// ── Recent Orders ────────────────────────────────────────────────────────────
export const recentOrders: Order[] = [
  { id: "#10491", customer: "Sarah Johnson", email: "sarah.j@example.com", product: "ArcadelX Pro", amount: 249, status: "completed", date: "Sep 21, 2026" },
  { id: "#10490", customer: "Marcus Lee", email: "m.lee@example.com", product: "Kiosk Starter", amount: 99, status: "processing", date: "Sep 21, 2026" },
  { id: "#10489", customer: "Elena Park", email: "e.park@example.com", product: "ArcadelX Pro", amount: 249, status: "completed", date: "Sep 20, 2026" },
  { id: "#10488", customer: "James Walker", email: "j.walker@example.com", product: "Enterprise Bundle", amount: 1499, status: "cancelled", date: "Sep 20, 2026" },
  { id: "#10487", customer: "Olivia Chen", email: "o.chen@example.com", product: "Kiosk Starter", amount: 99, status: "completed", date: "Sep 20, 2026" },
  { id: "#10486", customer: "Noah Davis", email: "n.davis@example.com", product: "ArcadelX Pro", amount: 249, status: "pending", date: "Sep 19, 2026" },
  { id: "#10485", customer: "Ava Thompson", email: "a.thompson@example.com", product: "Enterprise Bundle", amount: 1499, status: "completed", date: "Sep 19, 2026" },
  { id: "#10484", customer: "Liam Martinez", email: "l.martinez@example.com", product: "Kiosk Starter", amount: 99, status: "processing", date: "Sep 19, 2026" },
  { id: "#10483", customer: "Emma Wilson", email: "e.wilson@example.com", product: "ArcadelX Pro", amount: 249, status: "completed", date: "Sep 18, 2026" },
  { id: "#10482", customer: "William Taylor", email: "w.taylor@example.com", product: "Enterprise Bundle", amount: 1499, status: "completed", date: "Sep 18, 2026" },
]

// ── Top Products ─────────────────────────────────────────────────────────────
export const topProducts: TopProduct[] = [
  { rank: 1, name: "Enterprise Bundle", category: "License", revenue: 89940, units: 60, percentage: 100 },
  { rank: 2, name: "ArcadelX Pro", category: "License", revenue: 62250, units: 250, percentage: 69 },
  { rank: 3, name: "Kiosk Starter", category: "Hardware", revenue: 28710, units: 290, percentage: 32 },
  { rank: 4, name: "Support Premium", category: "Service", revenue: 18400, units: 184, percentage: 20 },
  { rank: 5, name: "API Add-on", category: "Add-on", revenue: 9200, units: 92, percentage: 10 },
]
