"use client"

import React from "react"
import RevenueWidget from '@/components/dashboard/widgets/RevenueWidget'
import OrdersWidget from '@/components/dashboard/widgets/OrdersWidget'
import CustomersWidget from '@/components/dashboard/widgets/CustomersWidget'
import SystemHealthWidget from '@/components/dashboard/widgets/SystemHealthWidget'
import ActivityWidget from '@/components/dashboard/widgets/ActivityWidget'

type Widget = { id: string; component: React.ReactNode }

const defaultWidgets: Widget[] = [
  { id: 'revenue', component: <RevenueWidget /> },
  { id: 'orders', component: <OrdersWidget /> },
  { id: 'customers', component: <CustomersWidget /> },
  { id: 'health', component: <SystemHealthWidget /> },
  { id: 'activity', component: <ActivityWidget /> },
]

function getWidgetById(id: string): Widget {
  const found = defaultWidgets.find((d) => d.id === id)
  return found ?? defaultWidgets[0]!
}

export default function DashboardGrid() {
  const [widgets, setWidgets] = React.useState<Widget[]>(() => {
    try {
      if (typeof window === 'undefined') return defaultWidgets
      const raw = localStorage.getItem('arcadelx-dashboard-widgets')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.every((p) => typeof p === 'string')) {
          return (parsed as string[]).map((id) => getWidgetById(id))
        }
        if (Array.isArray(parsed) && parsed.every((p) => p && typeof p === 'object' && 'id' in p)) {
          return (parsed as any[]).map((p) => getWidgetById(String(p.id)))
        }
      }
    } catch (e) {
      // ignore
    }
    return defaultWidgets
  })

  React.useEffect(() => {
    try {
      // migrate or initialize stored layout as an array of ids
      const raw = localStorage.getItem('arcadelx-dashboard-widgets')
      if (!raw) {
        const ids = widgets.map((w) => w.id)
        localStorage.setItem('arcadelx-dashboard-widgets', JSON.stringify(ids))
      }
    } catch (e) {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {widgets.map((w) => (
          <div key={w.id} className="bg-card border border-border rounded-md p-3">
            {w.component}
          </div>
        ))}
      </div>
    </div>
  )
}
