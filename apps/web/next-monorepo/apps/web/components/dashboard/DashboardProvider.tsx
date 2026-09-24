"use client"

import React from "react"
import InventoryChartWidget from '@/components/dashboard/widgets/InventoryChartWidget'
import PendingMembersWidget from '@/components/dashboard/widgets/PendingMembersWidget'
import CustomersWidget from '@/components/dashboard/widgets/CustomersWidget'
import SystemHealthWidget from '@/components/dashboard/widgets/SystemHealthWidget'
import ActivityWidget from '@/components/dashboard/widgets/ActivityWidget'

export type WidgetDef = { id: string; title: string; component: React.ReactNode }

const DEFAULT_WIDGETS: WidgetDef[] = [
  { id: 'inventory', title: 'Inventory', component: <InventoryChartWidget /> },
  { id: 'pending_members', title: 'Pending Members', component: <PendingMembersWidget /> },
  { id: 'customers', title: 'Customers', component: <CustomersWidget /> },
  { id: 'health', title: 'System Health', component: <SystemHealthWidget /> },
  { id: 'activity', title: 'Recent Activity', component: <ActivityWidget /> },
]

const STORAGE_KEY = 'arcadelx-dashboard-widgets'

type DashboardContextValue = {
  all: WidgetDef[]
  order: string[]
  visible: Record<string, boolean>
  widgetsForRender: WidgetDef[]
  toggleVisible: (id: string) => void
  setOrder: (ids: string[]) => void
  reset: () => void
}

const DashboardContext = React.createContext<DashboardContextValue | undefined>(undefined)

export function useDashboard() {
  const ctx = React.useContext(DashboardContext)
  if (!ctx) throw new Error('useDashboard must be used within DashboardProvider')
  return ctx
}

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [order, setOrderState] = React.useState<string[]>(() => {
    try {
      if (typeof window === 'undefined') return DEFAULT_WIDGETS.map((w) => w.id)
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.every((p) => typeof p === 'string')) {
          // ensure all ids exist in defaults
          const ids = (parsed as string[]).filter((id) => DEFAULT_WIDGETS.some((d) => d.id === id))
          return ids.length ? ids : DEFAULT_WIDGETS.map((w) => w.id)
        }
      }
    } catch (e) {
      // ignore
    }
    return DEFAULT_WIDGETS.map((w) => w.id)
  })

  const [visible, setVisible] = React.useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {}
    for (const w of DEFAULT_WIDGETS) map[w.id] = true
    try {
      if (typeof window === 'undefined') return map
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.every((p) => p && typeof p === 'object' && 'id' in p)) {
          // older format: array of objects with id & visible flags
          for (const p of parsed as any[]) {
            if (p && typeof p === 'object' && 'id' in p) {
              map[String(p.id)] = p.visible !== false
            }
          }
        }
      }
    } catch (e) {}
    return map
  })

  const widgetsForRender = React.useMemo(() => {
    return order.map((id) => DEFAULT_WIDGETS.find((d) => d.id === id)!).filter((w) => !!w && visible[w.id]) as WidgetDef[]
  }, [order, visible])

  React.useEffect(() => {
    try {
      // persist as simple array of ids + optional visibility map in legacy format
      const payload = order
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch (e) {}
  }, [order, visible])

  const toggleVisible = React.useCallback((id: string) => {
    setVisible((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const setOrder = React.useCallback((ids: string[]) => setOrderState(ids), [])

  const reset = React.useCallback(() => {
    setOrderState(DEFAULT_WIDGETS.map((w) => w.id))
    const map: Record<string, boolean> = {}
    for (const w of DEFAULT_WIDGETS) map[w.id] = true
    setVisible(map)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch (e) {}
  }, [])

  const ctxValue: DashboardContextValue = React.useMemo(
    () => ({ all: DEFAULT_WIDGETS, order, visible, widgetsForRender, toggleVisible, setOrder, reset }),
    [order, visible, widgetsForRender, toggleVisible, setOrder, reset]
  )

  return <DashboardContext.Provider value={ctxValue}>{children}</DashboardContext.Provider>
}
