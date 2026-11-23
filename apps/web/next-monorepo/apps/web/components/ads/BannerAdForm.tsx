"use client"

import { useRef, useState } from "react"
import { CalendarDays, RefreshCw, Upload, UploadCloud, X } from "lucide-react"
import type { BannerAd, BannerAdsConfig } from "@/lib/mothership-banner-ads-api"
import {
  buttonClass,
  fileExtension,
  formatBytes,
  formatDate,
  inputClass,
  primaryButtonClass,
} from "@/components/ads/format"

export type BannerAdFormValues = {
  title: string
  startDate: string
  daysToLive: number
  file: File | null
}

type Props = {
  mode: "create" | "edit"
  config: BannerAdsConfig
  ad: BannerAd | null
  isSaving: boolean
  progress: number | null
  error: string | null
  onCancel: () => void
  onSubmit: (values: BannerAdFormValues) => void
}

function validate(
  values: BannerAdFormValues,
  mode: "create" | "edit",
  config: BannerAdsConfig,
  ad: BannerAd | null,
): string | null {
  const title = values.title.trim()
  if (!title) return "Enter an advertisement title."
  if (title.length > 80) return "Keep the title within 80 characters."

  if (!values.startDate) return "Choose a start date."
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.startDate)) return "Choose a valid start date."

  const unchangedStart = mode === "edit" && ad !== null && values.startDate === ad.start_date
  if (!unchangedStart && values.startDate < config.today) {
    return `The start date cannot be before today (${config.today}).`
  }

  if (!Number.isInteger(values.daysToLive) || values.daysToLive < 1) {
    return "Choose a duration of at least one day."
  }
  if (values.daysToLive > config.max_days) {
    return `The duration cannot exceed ${config.max_days} days.`
  }

  if (mode === "create" && !values.file) return "Choose a video file."

  if (values.file) {
    if (values.file.size <= 0) return "Choose a non-empty video file."
    if (!config.allowed_extensions.includes(fileExtension(values.file.name))) {
      return `Allowed video types: ${config.allowed_extensions.join(", ")}.`
    }
    if (values.file.size > config.max_size_bytes) {
      return `The video must be smaller than ${formatBytes(config.max_size_bytes)}.`
    }
  }

  return null
}

export default function BannerAdForm({
  mode,
  config,
  ad,
  isSaving,
  progress,
  error,
  onCancel,
  onSubmit,
}: Props) {
  const [title, setTitle] = useState(ad?.title ?? "")
  const [startDate, setStartDate] = useState(ad?.start_date ?? config.today)
  const [daysToLive, setDaysToLive] = useState(ad?.days_to_live ?? 7)
  const [file, setFile] = useState<File | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const uploading = progress !== null && isSaving

  const chooseFile = (nextFile: File | null) => {
    setFile(nextFile)
    setValidationError(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const submit = () => {
    const values: BannerAdFormValues = {
      title: title.trim(),
      startDate,
      daysToLive,
      file,
    }
    const problem = validate(values, mode, config, ad)
    setValidationError(problem)
    if (problem) return
    onSubmit(values)
  }

  const reset = () => {
    setTitle("")
    setStartDate(config.today)
    setDaysToLive(7)
    setFile(null)
    setValidationError(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const message = validationError ?? error

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium sm:col-span-2">
            Title <span className="text-destructive">*</span>
            <input
              className={`${inputClass} mt-1.5`}
              maxLength={80}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Diwali Mega Sale"
              disabled={isSaving}
            />
          </label>

          <label className="text-sm font-medium">
            Start date <span className="text-destructive">*</span>
            <div className="relative mt-1.5">
              <CalendarDays
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                className={`${inputClass} pl-9`}
                type="date"
                min={mode === "create" ? config.today : undefined}
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                disabled={isSaving}
              />
            </div>
            <span className="mt-1 block text-xs text-muted-foreground">
              Today is {formatDate(config.today)} (IST).
            </span>
          </label>

          <label className="text-sm font-medium">
            Days to live <span className="text-destructive">*</span>
            <input
              className={`${inputClass} mt-1.5`}
              type="number"
              min={1}
              max={config.max_days}
              value={daysToLive}
              onChange={(event) => setDaysToLive(Number(event.target.value))}
              disabled={isSaving}
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              Up to {config.max_days} days.
            </span>
          </label>

          {mode === "edit" && ad && (
            <div className="rounded-lg border border-border bg-muted/25 p-3 text-xs sm:col-span-2">
              <p className="font-medium">Current video</p>
              <p className="mt-1 truncate text-muted-foreground" title={ad.filename}>
                {ad.filename} · {formatBytes(ad.file_size)} · v{ad.version}
              </p>
              <p className="mt-1 text-muted-foreground">
                Choose a new video below only if you want to replace it.
              </p>
            </div>
          )}
        </div>

        <div>
          <p className="text-sm font-medium">
            Video file {mode === "create" && <span className="text-destructive">*</span>}
          </p>
          <div
            onDragEnter={(event) => {
              event.preventDefault()
              setDragActive(true)
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              event.preventDefault()
              setDragActive(false)
            }}
            onDrop={(event) => {
              event.preventDefault()
              setDragActive(false)
              if (isSaving) return
              chooseFile(event.dataTransfer.files?.[0] ?? null)
            }}
            className={`mt-1.5 flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed p-4 text-center transition-colors ${
              dragActive ? "border-primary bg-primary/5" : "border-border bg-muted/20"
            }`}
          >
            <UploadCloud size={24} className="text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium">Drop a video here, or browse</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {config.allowed_extensions.join(", ")} · up to {config.max_size_mb} MB
            </p>
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept={config.allowed_extensions.join(",")}
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
              disabled={isSaving}
            />
            <button
              type="button"
              className={`${buttonClass} mt-3`}
              onClick={() => fileInputRef.current?.click()}
              disabled={isSaving}
            >
              Choose video
            </button>
          </div>

          {file && (
            <div className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2 text-xs">
              <span className="min-w-0 truncate" title={file.name}>
                {file.name} · {formatBytes(file.size)}
                {mode === "edit" ? " · replaces the current video" : ""}
              </span>
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => chooseFile(null)}
                aria-label="Remove selected video"
                disabled={isSaving}
              >
                <X size={15} />
              </button>
            </div>
          )}
        </div>
      </div>

      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}

      {progress !== null && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>{progress < 100 ? "Uploading video" : "Creating advertisement"}</span>
            <span>{progress}%</span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div className="h-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {mode === "edit" ? (
          <button type="button" className={buttonClass} onClick={onCancel} disabled={isSaving}>
            Cancel edit
          </button>
        ) : (
          <button type="button" className={buttonClass} onClick={reset} disabled={isSaving}>
            Clear
          </button>
        )}
        <button type="button" className={primaryButtonClass} onClick={submit} disabled={isSaving}>
          {isSaving ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
          {isSaving
            ? uploading
              ? "Uploading…"
              : "Saving…"
            : mode === "create"
              ? "Create advertisement"
              : "Save changes"}
        </button>
      </div>
    </div>
  )
}
