"use client"

import { Pencil, RefreshCw, Trash2 } from "lucide-react"
import type { BannerAd } from "@/lib/mothership-banner-ads-api"
import { bannerAdFileUrl } from "@/lib/mothership-banner-ads-api"
import { buttonClass, formatBytes, formatDate, statusMeta } from "@/components/ads/format"

type Props = {
  ad: BannerAd
  kiosksReporting: number
  canManage: boolean
  isDeleting: boolean
  onEdit: () => void
  onDelete: () => void
}

export default function BannerAdCard({
  ad,
  kiosksReporting,
  canManage,
  isDeleting,
  onEdit,
  onDelete,
}: Props) {
  const status = statusMeta(ad.status)
  const playing = ad.playing_on.length

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
      <video
        className="aspect-video w-full bg-black object-contain"
        controls
        preload="metadata"
        src={bannerAdFileUrl(ad.filename)}
      />
      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-semibold" title={ad.title}>
              {ad.title}
            </h3>
            <p className="mt-1 truncate text-xs text-muted-foreground" title={ad.filename}>
              {ad.filename} · {formatBytes(ad.file_size)} · v{ad.version}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}
          >
            {status.label}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-muted/35 p-3 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Starts</dt>
            <dd className="mt-0.5 font-medium">{formatDate(ad.start_date)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Ends</dt>
            <dd className="mt-0.5 font-medium">{formatDate(ad.last_day)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Duration</dt>
            <dd className="mt-0.5 font-medium">
              {ad.days_to_live} day{ad.days_to_live === 1 ? "" : "s"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Kiosks with video</dt>
            <dd className="mt-0.5 font-medium">
              {ad.kiosks_with_video} / {kiosksReporting}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Playing now</dt>
            <dd className="mt-0.5 font-medium">{playing}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Assignment</dt>
            <dd className="mt-0.5 font-medium">
              {ad.assignment_mode === "selected" ? "Selected kiosks" : "All kiosks"}
            </dd>
          </div>
        </dl>

        {playing > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Kiosks playing this advertisement">
            {ad.playing_on.map((kiosk) => (
              <span
                key={kiosk}
                className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {kiosk}
              </span>
            ))}
          </div>
        )}

        {canManage && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <button type="button" className={buttonClass} onClick={onEdit} disabled={isDeleting}>
              <Pencil size={15} aria-hidden="true" /> Edit
            </button>
            <button
              type="button"
              className={`${buttonClass} text-destructive hover:text-destructive`}
              onClick={onDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <RefreshCw size={15} className="animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 size={15} aria-hidden="true" />
              )}
              Delete
            </button>
          </div>
        )}
      </div>
    </article>
  )
}
