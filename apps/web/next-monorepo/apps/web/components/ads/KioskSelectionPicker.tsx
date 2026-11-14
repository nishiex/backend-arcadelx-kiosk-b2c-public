"use client"

import { useMemo, useState } from "react"
import { Check, Cpu, RefreshCw, Search } from "lucide-react"
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
  const selected = useMemo(() => new Set(selectedDeviceIds), [selectedDeviceIds])
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return devices.filter((device) => !needle || `${device.device_id} ${device.kiosk_number ?? ""} ${device.location ?? ""}`.toLowerCase().includes(needle))
  }, [devices, search])

  const toggle = (deviceId: string) => {
    const next = new Set(selected)
    if (next.has(deviceId)) next.delete(deviceId)
    else next.add(deviceId)
    onSelectionChange([...next])
  }

  return (
    <Panel title="Kiosk selection" subtitle={`${devices.length} kiosks returned by Mothership · ${selected.size} selected`} action={<div className="flex items-center gap-2"><div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input className="w-48 rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search kiosks" /></div><button className={buttonClass} onClick={onRefresh}><RefreshCw size={15} /> Refresh</button></div>}>
      {isLoading ? <Skeleton className="h-48" /> : error ? <ErrorState message={error.message} onRetry={onRefresh} /> : !filtered.length ? <EmptyState icon={<Cpu size={26} />} message={search ? "No kiosks match your search." : "Mothership returned no kiosks."} /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filtered.map((device) => <label key={device.device_id} className="cursor-pointer rounded-lg border border-border p-3 transition-colors hover:bg-muted/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5"><div className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={selected.has(device.device_id)} onChange={() => toggle(device.device_id)} /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="truncate font-mono text-xs font-semibold">{device.device_id}</span><span className={`inline-flex items-center gap-1 text-xs ${device.is_online ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}><span className={`h-1.5 w-1.5 rounded-full ${device.is_online ? "bg-emerald-500" : "bg-muted-foreground"}`} />{device.is_online ? "Online" : "Offline"}</span></div><p className="mt-1 text-xs text-muted-foreground">{device.kiosk_number !== null ? `Kiosk #${device.kiosk_number}` : "Kiosk number unavailable"}{device.location ? ` · ${device.location}` : ""}</p><div className="mt-2 space-y-1 border-t border-border pt-2 text-xs"><p className="font-medium">Currently holds: {device.ads.length || "none"}</p>{device.ads.slice(0, 3).map((ad) => <p key={`${device.device_id}-${ad.file}`} className="truncate text-muted-foreground" title={ad.file}>{ad.title || ad.file}{ad.version !== null ? ` · v${ad.version}` : ""}</p>)}{device.ads.length > 3 && <p className="text-muted-foreground">+{device.ads.length - 3} more</p>}</div></div></div></label>)}</div>}
      {selected.size > 0 && <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><Check size={14} className="text-primary" /> {selected.size} kiosk{selected.size === 1 ? "" : "s"} selected for Ads assignment.</p>}
    </Panel>
  )
}
