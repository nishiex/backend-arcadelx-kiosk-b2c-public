export const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"

export const buttonClass =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"

export const primaryButtonClass =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Dates arrive as YYYY-MM-DD in the upstream business timezone (IST). */
export function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      })
}

export function fileExtension(name: string): string {
  const index = name.lastIndexOf(".")
  return index === -1 ? "" : name.slice(index).toLowerCase()
}

/** Upstream status strings; unknown values still render as-is. */
export function statusMeta(status: string): { label: string; className: string } {
  if (status === "live") {
    return { label: "Live", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" }
  }
  if (status === "scheduled") {
    return { label: "Scheduled", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" }
  }
  if (status === "expired") {
    return { label: "Expired", className: "bg-muted text-muted-foreground" }
  }
  return { label: status, className: "bg-muted text-muted-foreground" }
}
