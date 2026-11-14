"use client"

import React, { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Clapperboard, Megaphone, Pencil, RefreshCw, Trash2, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { EmptyState, ErrorState, Panel, Skeleton } from "@/components/dashboard/ui"
import KioskSelectionPicker from "@/components/ads/KioskSelectionPicker"
import { useMe } from "@/hooks/useMe"
import {
  createMothershipAd,
  assignMothershipAd,
  deleteMothershipAd,
  fetchMothershipAds,
  fetchMothershipAdsConfig,
  fetchMothershipDevices,
  mothershipAdFileUrl,
  updateMothershipAd,
  uploadMothershipAd,
  type MothershipAd,
} from "@/lib/mothership-ads-api"

const inputClass = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
const buttonClass = "inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
const primaryButtonClass = "inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })
}

function statusClass(status: string) {
  if (status === "live") return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
  if (status === "scheduled") return "bg-blue-500/10 text-blue-600 dark:text-blue-400"
  return "bg-muted text-muted-foreground"
}

function validateFile(file: File, extensions: string[], maxBytes: number) {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase()
  if (!extensions.includes(extension)) return `Allowed video types: ${extensions.join(", ")}`
  if (file.size <= 0) return "Choose a non-empty video file."
  if (file.size > maxBytes) return `The video must be smaller than ${formatBytes(maxBytes)}.`
  return null
}

export default function AdsScreen() {
  const { isLoading: meLoading, canViewAds, canManageAds } = useMe()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<number | null>(null)
  const [title, setTitle] = useState("")
  const [startDate, setStartDate] = useState("")
  const [daysToLive, setDaysToLive] = useState(7)
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [search, setSearch] = useState("")
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([])

  const config = useQuery({ queryKey: ["mothership-ads-config"], queryFn: ({ signal }) => fetchMothershipAdsConfig(signal), enabled: canViewAds, staleTime: 60_000 })
  const ads = useQuery({ queryKey: ["mothership-ads"], queryFn: ({ signal }) => fetchMothershipAds(signal), enabled: canViewAds, refetchInterval: 15_000 })
  const devices = useQuery({ queryKey: ["mothership-devices"], queryFn: ({ signal }) => fetchMothershipDevices(signal), enabled: canViewAds, refetchInterval: 15_000 })

  useEffect(() => {
    if (config.data?.today && !startDate) setStartDate(config.data.today)
  }, [config.data?.today, startDate])

  const filteredAds = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (ads.data?.ads ?? []).filter((ad) => !needle || `${ad.title} ${ad.filename}`.toLowerCase().includes(needle))
  }, [ads.data?.ads, search])

  const resetForm = () => {
    setEditing(null)
    setTitle("")
    setFile(null)
    setDaysToLive(7)
    setStartDate(config.data?.today ?? "")
    setProgress(null)
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!canManageAds) throw new Error("Only Company Owners and Admins can manage Ads.")
      if (!title.trim()) throw new Error("Enter an advertisement title.")
      if (!startDate) throw new Error("Choose a start date.")
      if (!Number.isInteger(daysToLive) || daysToLive < 1 || daysToLive > (config.data?.max_days ?? 3650)) throw new Error("Choose a valid duration.")
      if (file) {
        const problem = validateFile(file, config.data?.allowed_extensions ?? [], config.data?.max_size_bytes ?? 0)
        if (problem) throw new Error(problem)
      }
      const uploadId = file ? await uploadMothershipAd(file, undefined, setProgress) : undefined
      if (editing === null) {
        if (!file || !uploadId) throw new Error("Choose a video file.")
        return createMothershipAd({ upload_id: uploadId, original_name: file.name, title: title.trim(), start_date: startDate, days_to_live: daysToLive })
      }
      return updateMothershipAd(editing, { title: title.trim(), start_date: startDate, days_to_live: daysToLive, ...(uploadId ? { upload_id: uploadId, original_name: file?.name } : {}) })
    },
    onSuccess: (result) => {
      toast.success(result.message)
      resetForm()
      void queryClient.invalidateQueries({ queryKey: ["mothership-ads"] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: (id: number) => deleteMothershipAd(id),
    onSuccess: (result) => {
      toast.success(result.message)
      void queryClient.invalidateQueries({ queryKey: ["mothership-ads"] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const assign = useMutation({
    mutationFn: ({ adId, deviceIds }: { adId: number; deviceIds: string[] }) => assignMothershipAd(adId, deviceIds),
    onSuccess: (result) => {
      toast.success(result.message)
      void queryClient.invalidateQueries({ queryKey: ["mothership-ads"] })
      void queryClient.invalidateQueries({ queryKey: ["mothership-devices"] })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const beginEdit = (ad: MothershipAd) => {
    setEditing(ad.id)
    setTitle(ad.title)
    setStartDate(ad.start_date)
    setDaysToLive(ad.days_to_live)
    setFile(null)
    setProgress(null)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  if (meLoading || config.isPending) return <Skeleton className="mx-auto h-96 max-w-7xl" />
  if (!canViewAds) return <EmptyState icon={<Megaphone size={28} />} message="Ads are available to active Company members only." />
  if (config.isError) return <ErrorState message={config.error.message} onRetry={() => void config.refetch()} />

  const configData = config.data
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ads</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage the Mothership screensaver library and kiosk delivery status.</p>
      </div>

      {canManageAds && (
        <Panel title={editing === null ? "Create advertisement" : `Edit advertisement #${editing}`} subtitle={`Allowed: ${configData.allowed_extensions.join(", ")} · Maximum ${configData.max_size_mb} MB`} action={editing !== null ? <button className={buttonClass} onClick={resetForm}><X size={16} /> Cancel</button> : undefined}>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium">Title<input className={`${inputClass} mt-1.5`} maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Diwali Mega Sale" /></label>
            <label className="text-sm font-medium">Video file<input className={`${inputClass} mt-1.5`} type="file" accept={configData.allowed_extensions.join(",")} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
            <label className="text-sm font-medium">Start date<input className={`${inputClass} mt-1.5`} type="date" min={configData.today} value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            <label className="text-sm font-medium">Days to live<input className={`${inputClass} mt-1.5`} type="number" min={1} max={configData.max_days} value={daysToLive} onChange={(event) => setDaysToLive(Number(event.target.value))} /></label>
          </div>
          {file && <p className="mt-3 text-xs text-muted-foreground">Selected: {file.name} · {formatBytes(file.size)}</p>}
          {progress !== null && <div className="mt-4"><div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>Uploading video</span><span>{progress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} /></div></div>}
          <div className="mt-4 flex justify-end"><button className={primaryButtonClass} disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />} {editing === null ? "Upload advertisement" : "Save changes"}</button></div>
        </Panel>
      )}

      <KioskSelectionPicker devices={devices.data ?? []} isLoading={devices.isPending} error={devices.isError ? devices.error : null} onRefresh={() => void devices.refetch()} selectedDeviceIds={selectedDeviceIds} onSelectionChange={setSelectedDeviceIds} />

      <Panel title="Advertisement library" subtitle={`${ads.data?.kiosks_reporting ?? 0} kiosks reporting`} action={<div className="flex items-center gap-2"><input className="rounded-lg border border-input bg-background px-3 py-2 text-sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ads" /><button className={buttonClass} onClick={() => void ads.refetch()}><RefreshCw size={16} /> Refresh</button></div>}>
        {ads.isPending ? <Skeleton className="h-64" /> : ads.isError ? <ErrorState message={ads.error.message} onRetry={() => void ads.refetch()} /> : !filteredAds.length ? <EmptyState icon={<Clapperboard size={28} />} message={search ? "No advertisements match your search." : "No advertisements have been uploaded yet."} /> : <div className="grid gap-4 lg:grid-cols-2">{filteredAds.map((ad) => <article key={ad.id} className="overflow-hidden rounded-xl border border-border bg-background"><video className="aspect-video w-full bg-black object-contain" controls preload="metadata" src={mothershipAdFileUrl(ad.filename)} /><div className="space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{ad.title}</h3><p className="mt-1 break-all text-xs text-muted-foreground">{ad.filename} · {formatBytes(ad.file_size)} · v{ad.version}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${statusClass(ad.status)}`}>{ad.status}</span></div><dl className="grid grid-cols-2 gap-2 text-xs"><div><dt className="text-muted-foreground">Starts</dt><dd>{formatDate(ad.start_date)}</dd></div><div><dt className="text-muted-foreground">Last day</dt><dd>{formatDate(ad.last_day)}</dd></div><div><dt className="text-muted-foreground">Delivery</dt><dd>{ad.assignment_mode === "selected" ? `${ad.assigned_devices.length} selected kiosks` : "All kiosks"}</dd></div><div><dt className="text-muted-foreground">On kiosks</dt><dd>{ad.kiosks_with_video} / {ads.data?.kiosks_reporting ?? 0}</dd></div><div><dt className="text-muted-foreground">Playing now</dt><dd>{ad.playing_on.length || "None"}</dd></div></dl>{canManageAds && <div className="flex flex-wrap gap-2 border-t border-border pt-3"><button className={buttonClass} onClick={() => beginEdit(ad)}><Pencil size={15} /> Edit</button><button className={`${buttonClass} text-destructive hover:text-destructive`} disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete ${ad.title}? This removes it from the server and kiosks on their next check-in.`)) remove.mutate(ad.id) }}><Trash2 size={15} /> Delete</button><button className={primaryButtonClass} disabled={!selectedDeviceIds.length || assign.isPending} onClick={() => assign.mutate({ adId: ad.id, deviceIds: selectedDeviceIds })}>{assign.isPending ? <RefreshCw size={15} className="animate-spin" /> : <Megaphone size={15} />} Assign selected kiosks</button></div>}</div></article>)}</div>}
      </Panel>
    </div>
  )
}
