"use client"

import React, { useMemo, useState } from "react"
import * as RadixDialog from "@radix-ui/react-dialog"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Clapperboard,
  Megaphone,
  Pencil,
  Play,
  RefreshCw,
  Trash,
  Upload,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { EmptyState, ErrorState, Panel, Skeleton } from "@/components/dashboard/ui"
import { useMe } from "@/hooks/useMe"
import { useOwnedKiosks } from "@/hooks/useOwnedKiosks"
import type { Kiosk } from "@/lib/backend-api"
import {
  createAd,
  deleteAd,
  discardAdUpload,
  fetchAdUploadConfig,
  fetchAds,
  initAdUpload,
  updateAd,
  uploadAdChunk,
  type Ad,
  type AdStatus,
  type AdUploadConfig,
} from "@/lib/ads-api"

const PAGE_SIZE = 24

const buttonClass =
  "inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
const primaryButtonClass =
  "inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
const labelClass = "mb-1.5 block text-sm font-medium"

const EXTENSION_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
}

const FILTERS: { value: AdStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
]

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ["KB", "MB", "GB", "TB"] as const
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit] ?? "KB"}`
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  // Explicit locale and zone keep server and client output identical.
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  })
}

/**
 * The server accepts one of a fixed MIME allowlist and insists the file extension matches.
 * Browsers do not always report a useful `file.type` (a `.mkv` often arrives as an empty
 * string), so the extension decides the type whenever it is in the allowlist.
 */
function resolveMimeType(file: File, config: AdUploadConfig): string | null {
  const dot = file.name.lastIndexOf(".")
  if (dot < 0) return null
  const extension = file.name.slice(dot).toLowerCase()
  if (!config.allowedExtensions.includes(extension)) return null

  const mapped = EXTENSION_MIME[extension]
  if (mapped && config.allowedMimeTypes.includes(mapped)) return mapped

  const declared = file.type.trim().toLowerCase()
  return declared && config.allowedMimeTypes.includes(declared) ? declared : null
}

export default function AdsScreen() {
  const { me, isLoading, isError, canViewAds, canManageAds } = useMe()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<AdStatus | "ALL">("ALL")
  const [page, setPage] = useState(1)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [editing, setEditing] = useState<Ad | null>(null)
  const [previewing, setPreviewing] = useState<Ad | null>(null)
  const [deleting, setDeleting] = useState<Ad | null>(null)

  // Scoped like the other screens: switching user, organization or role must not read
  // another account's cached library.
  const scope = [me?.id ?? "", me?.membership?.organizationId ?? "", me?.membership?.role ?? ""]
  const listKey = ["ads", "library", ...scope, filter, page]

  const ads = useQuery({
    queryKey: listKey,
    queryFn: () =>
      fetchAds({ page, limit: PAGE_SIZE, ...(filter === "ALL" ? {} : { status: filter }) }),
    enabled: canViewAds,
    staleTime: 30_000,
    retry: 1,
  })

  const kiosks = useOwnedKiosks({ includeNetworkInventory: true })
  // A retired machine cannot receive an ad: the API rejects it, so it is not offered here.
  const assignableKiosks = useMemo(
    () => (kiosks.data ?? []).filter((kiosk) => kiosk.status !== "RETIRED"),
    [kiosks.data],
  )
  const kioskById = useMemo(
    () => new Map((kiosks.data ?? []).map((kiosk) => [kiosk.id, kiosk])),
    [kiosks.data],
  )
  const kioskHint = kiosks.isLoading
    ? "Loading your kiosks…"
    : kiosks.isError
      ? "Your kiosks could not be loaded. The ad can still be saved unassigned."
      : assignableKiosks.length === 0
        ? "No assignable kiosks in your fleet yet. The ad can still be saved unassigned."
        : ""

  const invalidate = () => qc.invalidateQueries({ queryKey: ["ads", "library"] })

  function refresh() {
    void ads.refetch()
    void kiosks.refetch()
  }

  const rows = ads.data?.items ?? []
  const total = ads.data?.total ?? 0
  const totalPages = ads.data?.totalPages ?? 1

  if (isLoading) {
    return (
      <div aria-label="Loading ads" className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (isError) {
    return <ErrorState message="Unable to verify your access. Refresh the page to try again." />
  }
  if (!canViewAds) {
    return <EmptyState message="Video ads are managed by the Company account." />
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Video ads</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Promos that play on your kiosks. Upload a video, then choose which machines
            should run it.
            {!canManageAds && " Only the Company Owner or Admin can change the library."}
          </p>
        </div>
        <div className="flex gap-2">
          <button className={buttonClass} disabled={ads.isFetching} onClick={refresh}>
            <RefreshCw size={16} className={ads.isFetching ? "animate-spin" : ""} />
            {ads.isFetching ? "Refreshing…" : "Refresh"}
          </button>
          {canManageAds && (
            <button className={primaryButtonClass} onClick={() => setUploadOpen(true)}>
              <Upload size={16} /> Upload ad
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Filter ads by status"
          className="inline-flex rounded-lg border border-border bg-card p-0.5"
        >
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={filter === option.value}
              onClick={() => {
                setFilter(option.value)
                setPage(1)
              }}
              className={
                filter === option.value
                  ? "rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
                  : "rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
              }
            >
              {option.label}
            </button>
          ))}
        </div>
        {ads.data && (
          <p className="text-xs text-muted-foreground">
            {total} ad{total === 1 ? "" : "s"}
          </p>
        )}
      </div>

      <Panel
        title="Ad library"
        subtitle="Videos belong to your Company and can be assigned to any kiosk in its network: its own machines, plus the ones held by its Distributors and Partners."
      >
        {ads.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-52 w-full" />
            ))}
          </div>
        ) : ads.isError ? (
          <ErrorState message={ads.error.message} onRetry={() => void ads.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Megaphone size={22} />}
            message={
              filter === "ALL"
                ? "No ads uploaded yet. Upload a video to get started."
                : `No ${filter.toLowerCase()} ads.`
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((ad) => (
              <AdCard
                key={ad.id}
                ad={ad}
                kioskById={kioskById}
                canManage={canManageAds}
                onPreview={setPreviewing}
                onEdit={setEditing}
                onDelete={setDeleting}
              />
            ))}
          </div>
        )}
      </Panel>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <button
            className={buttonClass}
            disabled={page <= 1 || ads.isFetching}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Previous
          </button>
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <button
            className={buttonClass}
            disabled={page >= totalPages || ads.isFetching}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            Next
          </button>
        </div>
      )}

      {uploadOpen && (
        <UploadAdDialog
          kiosks={assignableKiosks}
          kioskHint={kioskHint}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => {
            setUploadOpen(false)
            void invalidate()
          }}
        />
      )}

      {editing && (
        <EditAdDialog
          ad={editing}
          kiosks={assignableKiosks}
          kioskHint={kioskHint}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void invalidate()
          }}
        />
      )}

      {previewing && <PreviewAdDialog ad={previewing} onClose={() => setPreviewing(null)} />}

      {deleting && (
        <DeleteAdDialog
          ad={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null)
            void invalidate()
          }}
        />
      )}
    </div>
  )
}

function StatusPill({ status }: { status: AdStatus }) {
  return (
    <span
      className={
        status === "ACTIVE"
          ? "shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400"
          : "shrink-0 rounded-full bg-slate-500/10 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-400"
      }
    >
      {status === "ACTIVE" ? "Active" : "Inactive"}
    </span>
  )
}

function AdCard({
  ad,
  kioskById,
  canManage,
  onPreview,
  onEdit,
  onDelete,
}: {
  ad: Ad
  kioskById: Map<string, Kiosk>
  canManage: boolean
  onPreview: (ad: Ad) => void
  onEdit: (ad: Ad) => void
  onDelete: (ad: Ad) => void
}) {
  return (
    <article className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        >
          <Clapperboard size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold" title={ad.title}>
            {ad.title}
          </h3>
          <p
            className="mt-0.5 truncate text-xs text-muted-foreground"
            title={ad.originalFilename}
          >
            {ad.originalFilename}
          </p>
        </div>
        <StatusPill status={ad.status} />
      </div>

      {ad.description && (
        <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{ad.description}</p>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">File size</dt>
          <dd className="mt-0.5 font-medium tabular-nums">{formatBytes(ad.videoSizeBytes)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Uploaded</dt>
          <dd className="mt-0.5 font-medium">{formatDate(ad.createdAt)}</dd>
        </div>
      </dl>

      <div className="mt-3 min-h-12">
        <p
          className="text-xs text-muted-foreground"
          title="Assigning an ad does not interrupt playback: the kiosk downloads it at its next sync and keeps its current playlist until then."
        >
          Assigned to
        </p>
        {ad.kioskIds.length === 0 ? (
          <p className="mt-1 text-xs">Not assigned to any kiosk</p>
        ) : (
          <div className="mt-1 flex flex-wrap gap-1">
            {ad.kioskIds.slice(0, 3).map((id) => (
              <span
                key={id}
                className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px]"
                title={kioskById.get(id)?.model ?? undefined}
              >
                {kioskById.get(id)?.machineCode ?? `${id.slice(0, 8)}…`}
              </span>
            ))}
            {ad.kioskIds.length > 3 && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                +{ad.kioskIds.length - 3} more
              </span>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
        <button type="button" className={buttonClass} onClick={() => onPreview(ad)}>
          <Play size={14} /> Preview
        </button>
        {canManage && (
          <>
            <button type="button" className={buttonClass} onClick={() => onEdit(ad)}>
              <Pencil size={14} /> Edit
            </button>
            <button
              type="button"
              className={`${buttonClass} ml-auto text-destructive`}
              onClick={() => onDelete(ad)}
            >
              <Trash size={14} /> Delete
            </button>
          </>
        )}
      </div>
    </article>
  )
}

function DialogShell({
  title,
  description,
  onClose,
  children,
  maxWidth = "max-w-lg",
}: {
  title: string
  description: string
  onClose: () => void
  children: React.ReactNode
  maxWidth?: string
}) {
  return (
    <RadixDialog.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <RadixDialog.Content
          className={`fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[95%] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl ${maxWidth}`}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <RadixDialog.Title className="text-lg font-semibold">{title}</RadixDialog.Title>
              <RadixDialog.Description className="mt-1 text-sm text-muted-foreground">
                {description}
              </RadixDialog.Description>
            </div>
            <RadixDialog.Close
              aria-label="Close dialog"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            >
              <X size={18} />
            </RadixDialog.Close>
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

function KioskPicker({
  kiosks,
  selected,
  onChange,
  disabled,
  emptyMessage,
}: {
  kiosks: Kiosk[]
  selected: string[]
  onChange: (next: string[]) => void
  disabled: boolean
  emptyMessage: string
}) {
  return (
    <fieldset>
      <legend className={labelClass}>Play on</legend>
      <p className="mb-2 text-xs text-muted-foreground">
        Leave every box unchecked to keep the ad unassigned.
      </p>
      {kiosks.length === 0 ? (
        <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {emptyMessage || "No assignable kiosks in your fleet yet."}
        </p>
      ) : (
        <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-lg border border-border p-2">
          {kiosks.map((kiosk) => {
            const checked = selected.includes(kiosk.id)
            const holderOrg =
              kiosk.assignedOrg ?? (kiosk.currentOrg?.type !== "COMPANY" ? kiosk.currentOrg : null)
            return (
              <label
                key={kiosk.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted/60"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={checked}
                  disabled={disabled}
                  onChange={() =>
                    onChange(
                      checked
                        ? selected.filter((id) => id !== kiosk.id)
                        : [...selected, kiosk.id],
                    )
                  }
                />
                <span className="font-mono text-xs">{kiosk.machineCode}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {kiosk.model ?? "Unknown model"}
                </span>
                {holderOrg && (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {holderOrg.name} ({holderOrg.type.toLowerCase()})
                  </span>
                )}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {kiosk.location ?? kiosk.status.toLowerCase()}
                </span>
              </label>
            )
          })}
        </div>
      )}
      <p className="mt-1 text-xs text-muted-foreground">{selected.length} selected</p>
    </fieldset>
  )
}

function UploadAdDialog({
  kiosks,
  kioskHint,
  onClose,
  onUploaded,
}: {
  kiosks: Kiosk[]
  kioskHint: string
  onClose: () => void
  onUploaded: () => void
}) {
  const config = useQuery({
    queryKey: ["ads", "config"],
    queryFn: fetchAdUploadConfig,
    staleTime: 10 * 60 * 1000,
    retry: 1,
  })

  if (config.isPending) {
    return (
      <DialogShell
        title="Upload ad"
        description="Loading the upload limits."
        onClose={onClose}
      >
        <Skeleton className="h-40 w-full" />
      </DialogShell>
    )
  }

  if (config.isError) {
    return (
      <DialogShell
        title="Upload ad"
        description="The upload configuration could not be loaded."
        onClose={onClose}
      >
        <ErrorState message={config.error.message} onRetry={() => void config.refetch()} />
      </DialogShell>
    )
  }

  return (
    <UploadAdForm
      config={config.data}
      kiosks={kiosks}
      kioskHint={kioskHint}
      onClose={onClose}
      onUploaded={onUploaded}
    />
  )
}

function UploadAdForm({
  config,
  kiosks,
  kioskHint,
  onClose,
  onUploaded,
}: {
  config: AdUploadConfig
  kiosks: Kiosk[]
  kioskHint: string
  onClose: () => void
  onUploaded: () => void
}) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [kioskIds, setKioskIds] = useState<string[]>([])
  const [validation, setValidation] = useState("")
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null)

  const upload = useMutation({
    mutationFn: async () => {
      const trimmedTitle = title.trim()
      if (!trimmedTitle) throw new Error("Enter a title for this ad.")
      if (trimmedTitle.length > 200) throw new Error("The title must be 200 characters or fewer.")
      if (description.trim().length > 2000) {
        throw new Error("The description must be 2000 characters or fewer.")
      }
      if (!file) throw new Error("Choose a video file to upload.")
      if (file.size === 0) throw new Error("That video file is empty.")
      if (file.size > config.maxVideoSizeBytes) {
        throw new Error(
          `The video is ${formatBytes(file.size)}; the limit is ${formatBytes(config.maxVideoSizeBytes)}.`,
        )
      }
      const mimeType = resolveMimeType(file, config)
      if (!mimeType) {
        throw new Error(`Use one of these video types: ${config.allowedExtensions.join(", ")}.`)
      }

      setProgress({ sent: 0, total: file.size })
      const session = await initAdUpload({
        originalFilename: file.name,
        mimeType,
        totalSize: file.size,
      })

      try {
        // Sequential on purpose: each request is one exact slice, and a retried slice
        // overwrites its own offset on the server.
        for (let index = 0; index < session.totalChunks; index += 1) {
          const start = index * session.chunkSize
          const end = Math.min(start + session.chunkSize, file.size)
          await uploadAdChunk(session.uploadId, index, file.slice(start, end))
          setProgress({ sent: end, total: file.size })
        }

        return await createAd({
          title: trimmedTitle,
          ...(description.trim() ? { description: description.trim() } : {}),
          uploadId: session.uploadId,
          kioskIds,
        })
      } catch (error) {
        // The bytes are already on the server. Discard the session so a rejected create
        // cannot leave an orphaned upload behind.
        await discardAdUpload(session.uploadId).catch(() => undefined)
        throw error
      }
    },
    onSuccess: () => {
      toast.success("Ad uploaded")
      onUploaded()
    },
    onError: (error) => setValidation(error.message),
  })

  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.sent / progress.total) * 100))
      : 0

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (upload.isPending) return
    setValidation("")
    upload.mutate()
  }

  return (
    <DialogShell
      title="Upload ad"
      description={`Up to ${formatBytes(config.maxVideoSizeBytes)} · ${config.allowedExtensions.join(", ")}`}
      onClose={() => {
        // Closing mid-upload would abandon a session the user cannot see; wait it out.
        if (!upload.isPending) onClose()
      }}
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="ad-title" className={labelClass}>
            Title
          </label>
          <input
            id="ad-title"
            className={inputClass}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            placeholder="Summer promo"
            disabled={upload.isPending}
            autoFocus
          />
        </div>

        <div>
          <label htmlFor="ad-description" className={labelClass}>
            Description <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="ad-description"
            className={`${inputClass} min-h-20 resize-y`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={2000}
            placeholder="Where or when this ad should run"
            disabled={upload.isPending}
          />
        </div>

        <div>
          <label htmlFor="ad-file" className={labelClass}>
            Video file
          </label>
          <input
            id="ad-file"
            type="file"
            accept={config.allowedExtensions.join(",")}
            disabled={upload.isPending}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null)
              setValidation("")
            }}
            className="block w-full cursor-pointer rounded-lg border border-dashed border-border bg-background px-3 py-5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
          {file && (
            <p className="mt-1 text-xs text-muted-foreground">
              {file.name} · {formatBytes(file.size)}
            </p>
          )}
        </div>

        <KioskPicker
          kiosks={kiosks}
          selected={kioskIds}
          onChange={setKioskIds}
          disabled={upload.isPending}
          emptyMessage={kioskHint}
        />

        {progress && (
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{upload.isPending ? `Uploading ${percent}%` : `Uploaded ${percent}%`}</span>
              <span className="tabular-nums">
                {formatBytes(progress.sent)} / {formatBytes(progress.total)}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Upload progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="mt-1 h-2 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}

        {(validation || upload.isError) && (
          <p role="alert" className="text-sm text-destructive">
            {validation || upload.error?.message}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className={buttonClass}
            onClick={onClose}
            disabled={upload.isPending}
          >
            Cancel
          </button>
          <button type="submit" className={primaryButtonClass} disabled={upload.isPending}>
            <Upload size={16} />
            {upload.isPending ? "Uploading…" : "Upload ad"}
          </button>
        </div>
      </form>
    </DialogShell>
  )
}

function EditAdDialog({
  ad,
  kiosks,
  kioskHint,
  onClose,
  onSaved,
}: {
  ad: Ad
  kiosks: Kiosk[]
  kioskHint: string
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(ad.title)
  const [description, setDescription] = useState(ad.description ?? "")
  const [status, setStatus] = useState<AdStatus>(ad.status)
  const [validation, setValidation] = useState("")

  const ownedKioskIds = useMemo(() => new Set(kiosks.map((kiosk) => kiosk.id)), [kiosks])
  // A machine that left the fleet cannot be re-sent: the API only accepts kiosks this
  // organization owns right now. Start from the still-owned subset and say what drops.
  const detachedCount = ad.kioskIds.filter((id) => !ownedKioskIds.has(id)).length
  const [kioskIds, setKioskIds] = useState<string[]>(
    ad.kioskIds.filter((id) => ownedKioskIds.has(id)),
  )

  const save = useMutation({
    mutationFn: async () => {
      const trimmedTitle = title.trim()
      if (!trimmedTitle) throw new Error("Enter a title for this ad.")
      if (trimmedTitle.length > 200) throw new Error("The title must be 200 characters or fewer.")
      if (description.trim().length > 2000) {
        throw new Error("The description must be 2000 characters or fewer.")
      }
      return updateAd(ad.id, {
        title: trimmedTitle,
        description: description.trim() || null,
        status,
        kioskIds,
      })
    },
    onSuccess: () => {
      toast.success("Ad updated")
      onSaved()
    },
    onError: (error) => setValidation(error.message),
  })

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (save.isPending) return
    setValidation("")
    save.mutate()
  }

  return (
    <DialogShell
      title="Edit ad"
      description={`${ad.originalFilename} · ${formatBytes(ad.videoSizeBytes)}`}
      onClose={() => {
        if (!save.isPending) onClose()
      }}
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="ad-edit-title" className={labelClass}>
            Title
          </label>
          <input
            id="ad-edit-title"
            className={inputClass}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            disabled={save.isPending}
            autoFocus
          />
        </div>

        <div>
          <label htmlFor="ad-edit-description" className={labelClass}>
            Description <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="ad-edit-description"
            className={`${inputClass} min-h-20 resize-y`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={2000}
            disabled={save.isPending}
          />
        </div>

        <div>
          <label htmlFor="ad-edit-status" className={labelClass}>
            Status
          </label>
          <select
            id="ad-edit-status"
            className={inputClass}
            value={status}
            onChange={(event) => setStatus(event.target.value as AdStatus)}
            disabled={save.isPending}
          >
            <option value="ACTIVE">Active — play on the assigned kiosks</option>
            <option value="INACTIVE">Inactive — keep it, but do not play it</option>
          </select>
        </div>

        <KioskPicker
          kiosks={kiosks}
          selected={kioskIds}
          onChange={setKioskIds}
          disabled={save.isPending}
          emptyMessage={kioskHint}
        />

        {detachedCount > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            {detachedCount} machine{detachedCount === 1 ? "" : "s"} that used to play this ad
            {detachedCount === 1 ? " is" : " are"} no longer in your fleet. Saving removes
            {detachedCount === 1 ? " it" : " them"} from the assignment.
          </p>
        )}

        {(validation || save.isError) && (
          <p role="alert" className="text-sm text-destructive">
            {validation || save.error?.message}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className={buttonClass}
            onClick={onClose}
            disabled={save.isPending}
          >
            Cancel
          </button>
          <button type="submit" className={primaryButtonClass} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </DialogShell>
  )
}

function PreviewAdDialog({ ad, onClose }: { ad: Ad; onClose: () => void }) {
  return (
    <DialogShell
      title={ad.title}
      description="Preview the stored video before assigning it."
      onClose={onClose}
      maxWidth="max-w-3xl"
    >
      <video
        key={ad.id}
        src={ad.videoUrl}
        controls
        autoPlay
        playsInline
        className="aspect-video w-full rounded-lg bg-black"
      />
      {ad.description && <p className="mt-3 text-sm text-muted-foreground">{ad.description}</p>}
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">File</dt>
          <dd className="mt-0.5 break-all">{ad.originalFilename}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Size</dt>
          <dd className="mt-0.5 tabular-nums">{formatBytes(ad.videoSizeBytes)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Type</dt>
          <dd className="mt-0.5">{ad.mimeType}</dd>
        </div>
      </dl>
    </DialogShell>
  )
}

function DeleteAdDialog({
  ad,
  onClose,
  onDeleted,
}: {
  ad: Ad
  onClose: () => void
  onDeleted: () => void
}) {
  const remove = useMutation({
    mutationFn: () => deleteAd(ad.id),
    onSuccess: () => {
      toast.success("Ad deleted")
      onDeleted()
    },
    onError: (error) => toast.error(`Could not delete the ad: ${error.message}`),
  })

  return (
    <DialogShell
      title="Delete ad"
      description="This removes the video file and every kiosk assignment. It cannot be undone."
      onClose={() => {
        if (!remove.isPending) onClose()
      }}
    >
      <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
        <span className="font-medium">{ad.title}</span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {ad.originalFilename} · {formatBytes(ad.videoSizeBytes)} · {ad.kioskIds.length} kiosk
          {ad.kioskIds.length === 1 ? "" : "s"}
        </span>
      </p>

      {remove.isError && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {remove.error.message}
        </p>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={buttonClass} onClick={onClose} disabled={remove.isPending}>
          Cancel
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg bg-destructive px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
        >
          <Trash size={14} /> {remove.isPending ? "Deleting…" : "Delete ad"}
        </button>
      </div>
    </DialogShell>
  )
}
