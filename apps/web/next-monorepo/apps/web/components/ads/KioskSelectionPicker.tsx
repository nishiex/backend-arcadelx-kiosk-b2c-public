"use client"

import { useMemo, useState } from "react"
import { Check, ChevronDown, RefreshCw, Search, X } from "lucide-react"
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
  const [isOpen, setIsOpen] = useState(false)
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

  const allFilteredSelected = filtered.length > 0 && filtered.every((device) => selected.has(device.device_id))
  const toggleAllFiltered = () => {
    const next = new Set(selected)
    if (allFilteredSelected) filtered.forEach((device) => next.delete(device.device_id))
    else filtered.forEach((device) => next.add(device.device_id))
    onSelectionChange([...next])
  }
  const selectedLabel = selected.size ? `${selected.size} kiosk${selected.size === 1 ? "" : "s"} selected` : "Select kiosks (optional)"

  return (
    <div className="relative">
      <label className="text-sm font-medium">Kiosks <span className="font-normal text-muted-foreground">(optional)</span></label>
      <button type="button" className="mt-1.5 flex w-full items-center justify-between rounded-lg border border-input bg-background px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-muted/40 focus:ring-2 focus:ring-ring/40" onClick={() => setIsOpen((value) => !value)} aria-expanded={isOpen} aria-haspopup="listbox">
        <span className={selected.size ? "font-medium" : "text-muted-foreground"}>{selectedLabel}</span>
        <ChevronDown size={17} className={`shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>
      <p className="mt-1.5 text-xs text-muted-foreground">Select targets now, then choose an advertisement in the library to assign them.</p>

      {isOpen && <div className="absolute z-30 mt-2 w-full rounded-xl border border-border bg-popover p-3 shadow-xl">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input autoFocus aria-label="Search kiosks" className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search kiosk, location, or device ID" /></div>
          <select aria-label="Filter kiosks by connection status" className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40" value={availability} onChange={(event) => setAvailability(event.target.value as typeof availability)}><option value="all">All statuses</option><option value="online">Online only</option><option value="offline">Offline only</option></select>
        </div>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-border" role="listbox" aria-multiselectable="true">
          {isLoading ? <p className="p-4 text-sm text-muted-foreground">Loading kiosks…</p> : error ? <div className="flex items-center justify-between gap-3 p-4 text-sm text-destructive"><span>{error.message}</span><button className={buttonClass} onClick={onRefresh}><RefreshCw size={14} /> Retry</button></div> : !filtered.length ? <p className="p-4 text-sm text-muted-foreground">No kiosks match these filters.</p> : filtered.map((device) => {
            const isSelected = selected.has(device.device_id)
            return <label key={device.device_id} className={`flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0 ${isSelected ? "bg-primary/5" : "hover:bg-muted/40"}`}><input type="checkbox" className="h-4 w-4 accent-primary" checked={isSelected} onChange={() => toggle(device.device_id)} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{device.kiosk_number !== null ? `Kiosk #${device.kiosk_number}` : device.device_id}</span><span className="block truncate text-xs text-muted-foreground">{device.location || device.device_id}</span></span><span className={`text-xs ${device.is_online ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>{device.is_online ? "Online" : "Offline"}</span>{isSelected && <Check size={15} className="text-primary" />}</label>
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{selectedLabel}</span><div className="flex flex-wrap gap-2">{filtered.length > 0 && <button type="button" className={buttonClass} onClick={toggleAllFiltered}><Check size={14} /> {allFilteredSelected ? `Unselect all (${filtered.length})` : `Select all (${filtered.length})`}</button>}<button className={buttonClass} onClick={onRefresh}><RefreshCw size={14} /> Refresh</button>{selected.size > 0 && <button className={buttonClass} onClick={() => onSelectionChange([])}><X size={14} /> Clear</button>}<button className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" onClick={() => setIsOpen(false)}>Done</button></div></div>
      </div>}
    </div>
  )
}
