"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Megaphone, RefreshCw, Search, X } from "lucide-react"
import { toast } from "sonner"
import { EmptyState, ErrorState, Panel, Skeleton } from "@/components/dashboard/ui"
import BannerAdCard from "@/components/ads/BannerAdCard"
import BannerAdForm, { type BannerAdFormValues } from "@/components/ads/BannerAdForm"
import { buttonClass } from "@/components/ads/format"
import { useMe } from "@/hooks/useMe"
import { createBannerAd, deleteBannerAd, fetchBannerAds, fetchBannerAdsConfig, updateBannerAd, uploadBannerAd, type BannerAd } from "@/lib/mothership-banner-ads-api"

export default function BannerAdsScreen() {
  const { isLoading: meLoading, canViewAds, canManageAds } = useMe()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<BannerAd | null>(null)
  const [version, setVersion] = useState(0)
  const [progress, setProgress] = useState<number | null>(null)
  const [search, setSearch] = useState("")

  const config = useQuery({ queryKey: ["banner-ads-config"], queryFn: ({ signal }) => fetchBannerAdsConfig(signal), enabled: canViewAds, staleTime: 60_000 })
  const ads = useQuery({ queryKey: ["banner-ads"], queryFn: ({ signal }) => fetchBannerAds(signal), enabled: canViewAds, refetchInterval: 15_000 })
  const allAds = ads.data?.ads ?? []
  const visibleAds = useMemo(() => { const needle = search.trim().toLowerCase(); return allAds.filter((ad) => !needle || `${ad.title} ${ad.filename}`.toLowerCase().includes(needle)) }, [allAds, search])

  const reset = () => { setEditing(null); setProgress(null); setVersion((value) => value + 1) }
  const save = useMutation({
    mutationFn: async (values: BannerAdFormValues) => {
      if (!canManageAds) throw new Error("Only the Company Owner can manage Banner Ads.")
      let uploadId: string | undefined
      if (values.file) { setProgress(0); uploadId = await uploadBannerAd(values.file, { onProgress: setProgress }) }
      if (editing) return updateBannerAd(editing.id, { title: values.title, start_date: values.startDate, days_to_live: values.daysToLive, ...(uploadId && values.file ? { upload_id: uploadId, original_name: values.file.name } : {}) })
      if (!uploadId || !values.file) throw new Error("Choose a video file.")
      return createBannerAd({ upload_id: uploadId, original_name: values.file.name, title: values.title, start_date: values.startDate, days_to_live: values.daysToLive })
    },
    onSuccess: (result) => { toast.success(result.message); reset(); void queryClient.invalidateQueries({ queryKey: ["banner-ads"] }) },
    onError: (error: Error) => { setProgress(null); toast.error(error.message) },
  })
  const remove = useMutation({ mutationFn: (ad: BannerAd) => deleteBannerAd(ad.id), onSuccess: (result) => { toast.success(result.message); reset(); void queryClient.invalidateQueries({ queryKey: ["banner-ads"] }) }, onError: (error: Error) => toast.error(error.message) })

  if (meLoading || config.isPending) return <Skeleton className="mx-auto h-96 max-w-7xl" />
  if (!canViewAds) return <EmptyState icon={<Megaphone size={28} />} message="Banner Ads are available to active Company members only." />
  if (config.isError) return <ErrorState message={config.error.message} onRetry={() => void config.refetch()} />
  const configData = config.data
  const live = allAds.filter((ad) => ad.status === "live").length
  const scheduled = allAds.filter((ad) => ad.status === "scheduled").length
  const expired = allAds.filter((ad) => ad.status === "expired").length

  return <div className="mx-auto max-w-7xl space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Banner Ads</h1><p className="mt-1 text-sm text-muted-foreground">Manage wide-format banner campaigns separately from regular kiosk Ads.</p></div><p className="text-xs text-muted-foreground">Today is {configData.today} (IST) · up to {configData.max_size_mb} MB · {configData.allowed_extensions.join(", ")} only</p></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><div className="rounded-xl border border-border bg-card px-4 py-3"><p className="text-xs text-muted-foreground">Live now</p><p className="mt-1 text-2xl font-semibold">{live}</p></div><div className="rounded-xl border border-border bg-card px-4 py-3"><p className="text-xs text-muted-foreground">Scheduled</p><p className="mt-1 text-2xl font-semibold">{scheduled}</p></div><div className="rounded-xl border border-border bg-card px-4 py-3"><p className="text-xs text-muted-foreground">Expired</p><p className="mt-1 text-2xl font-semibold">{expired}</p></div><div className="rounded-xl border border-border bg-card px-4 py-3"><p className="text-xs text-muted-foreground">Kiosks reporting</p><p className="mt-1 text-2xl font-semibold">{ads.data?.kiosks_reporting ?? 0}</p></div></div>
    {canManageAds && <Panel title={editing ? `Edit Banner Ad #${editing.id}` : "Create Banner Ad"} subtitle="Banner Ads use their own upload and scheduling workflow." action={editing ? <button type="button" className={buttonClass} onClick={reset}><X size={16} /> Cancel edit</button> : undefined}><BannerAdForm key={`${editing?.id ?? "create"}-${version}`} mode={editing ? "edit" : "create"} config={configData} ad={editing} isSaving={save.isPending} progress={progress} error={save.error instanceof Error ? save.error.message : null} onCancel={reset} onSubmit={(values) => save.mutate(values)} /></Panel>}
    <Panel title="Banner Ad library" subtitle={`${allAds.length} banner ad${allAds.length === 1 ? "" : "s"}`} action={<div className="flex flex-wrap items-center gap-2"><div className="relative"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input aria-label="Search banner ads" className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm sm:w-52" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search banner ads" /></div><button type="button" className={buttonClass} onClick={() => void ads.refetch()}><RefreshCw size={16} /> Refresh</button></div>}>{ads.isPending ? <Skeleton className="h-64" /> : ads.isError ? <ErrorState message={ads.error.message} onRetry={() => void ads.refetch()} /> : !visibleAds.length ? <EmptyState icon={<Megaphone size={28} />} message={search ? "No banner ads match your search." : "No banner ads have been uploaded yet."} /> : <div className="grid gap-4 lg:grid-cols-2">{visibleAds.map((ad) => <BannerAdCard key={ad.id} ad={ad} kiosksReporting={ads.data?.kiosks_reporting ?? 0} canManage={canManageAds} isDeleting={remove.isPending} onEdit={() => { setEditing(ad); setVersion((value) => value + 1); window.scrollTo({ top: 0, behavior: "smooth" }) }} onDelete={() => { if (window.confirm(`Delete ${ad.title}?`)) remove.mutate(ad) }} />)}</div>}</Panel>
  </div>
}
