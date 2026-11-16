"use client"

import { useMemo, useState } from "react"
import { Check, Cpu, RefreshCw, Search, X } from "lucide-react"
import { EmptyState, ErrorState, Panel, Skeleton } from "@/components/dashboard/ui"
import type { MothershipDevice } from "@/lib/mothership-ads-api"

const buttonClass = "inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"

export default function KioskSelectionPicker({
  devices,
  isLoading,
  error,
  onRefresh,
  selectedDeviceIds,
  onSelectionChange,
}: {
  devices: MothershipDevice[]
  isLoading: boolean
  error?: Error | null
  onRefresh: () => void
  selectedDeviceIds: string[]
  onSelectionChange: (deviceIds: string[]) => void
}) {
  const [search, setSearch] = useState("")
  const [availability, setAvailability] = useState<"all" | "online" | "offline">("all")
  const selected = useMemo(() => new Set(selectedDeviceIds), [selectedDeviceIds])
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return devices.filter((device) => {
      const matchesSearch = !needle || `${device.device_id} ${device.kiosk_number ?? ""} ${device.location ?? ""}`.toLowerCase().includes(needle)
      const matchesAvailability = availability === "all" || (availability === "online" ? device.is_online : !device.is_online)
      return matchesSearch && matchesAvailability
    })
  }, [availability, devices, search])

  const toggle = (deviceId: string) => {
    const next = new Set(selected)
    if (next.has(deviceId)) next.delete(deviceId)
    else next.add(deviceId)
    onSelectionChange([...next])
  }

  const selectedLabel = `${selected.size} kiosk${selected.size === 1 ? "" : "s"} selected`

  return (
    <Panel
      title="2. Select kiosks"
      subtitle="Choose delivery targets here, then assign them from an advertisement card below."
      action={<div className="flex flex-wrap items-center gap-2">{selected.size > 0 && <span className="rounded-full bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary">{selectedLabel}</span>}<button className={buttonClass} onClick={onRefresh}><RefreshCw size={15} /> Refresh</button></div>}
    >
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input aria-label="Search kiosks" className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by kiosk, location, or device ID" /></div>
        <select aria-label="Filter kiosks by connection status" className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40" value={availability} onChange={(event) => setAvailability(event.target.value as typeof availability)}><option value="all">All statuses</option><option value="online">Online only</option><option value="offline">Offline only</option></select>
        {selected.size > 0 && <button className={buttonClass} onClick={() => onSelectionChange([])}><X size={15} /> Clear</button>}
      </div>

      {isLoading ? <Skeleton className="h-48" /> : error ? <ErrorState message={error.message} onRetry={onRefresh} /> : !filtered.length ? <EmptyState icon={<Cpu size={26} />} message={search || availability !== "all" ? "No kiosks match these filters." : "Mothership returned no kiosks."} /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filtered.map((device) => {
        const isSelected = selected.has(device.device_id)
        return <label key={device.device_id} className={`cursor-pointer rounded-xl border p-3 transition-colors ${isSelected ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-background hover:bg-muted/40"}`}><div className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={isSelected} onChange={() => toggle(device.device_id)} /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="truncate font-mono text-xs font-semibold">{device.device_id}</span><span className={`inline-flex items-center gap-1 text-xs ${device.is_online ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}><span className={`h-1.5 w-1.5 rounded-full ${device.is_online ? "bg-emerald-500" : "bg-muted-foreground"}`} />{device.is_online ? "Online" : "Offline"}</span></div><p className="mt-1 text-xs text-muted-foreground">{device.kiosk_number !== null ? `Kiosk #${device.kiosk_number}` : "Kiosk number unavailable"}{device.location ? ` · ${device.location}` : ""}</p><div className="mt-2 space-y-1 border-t border-border pt-2 text-xs"><p className="font-medium">Currently holds: {device.ads.length || "none"}</p>{device.ads.slice(0, 3).map((ad) => <p key={`${device.device_id}-${ad.file}`} className="truncate text-muted-foreground" title={ad.file}>{ad.title || ad.file}{ad.version !== null ? ` · v${ad.version}` : ""}</p>)}{device.ads.length > 3 && <p className="text-muted-foreground">+{device.ads.length - 3} more</p>}</div></div></div></label>
      })}</div>}

      {selected.size > 0 && <p className="mt-4 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground"><Check size={14} className="shrink-0 text-primary" /> {selectedLabel}. In step 3, choose the advertisement that should appear on these kiosks.</p>}
    </Panel>
  )
}
