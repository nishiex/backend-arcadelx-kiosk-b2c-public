import { sessionApiFetch } from "@/lib/session-api"

/**
 * Client for the Banner Ads API, proxied through our Express backend (`/api/banner-ads`)
 * to enforce session authentication and role checks before reaching Mothership.
 */
const BANNER_ADS_API_PATH = "/api/banner-ads"

/** A chunk that times out mid-upload wastes the whole file, so uploads get more room. */
const REQUEST_TIMEOUT_MS = 20_000
const UPLOAD_TIMEOUT_MS = 120_000

/** Matches the dashboard's existing uploader and Mothership's accepted chunk size. */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024

/**
 * Kiosk playback is WebM-only. Mothership also accepts .mov/.mp4, but the dashboard
 * deliberately offers just the container the hardware can play.
 */
const DASHBOARD_ALLOWED_EXTENSIONS = [".webm"]

export type BannerAdsConfig = {
  allowed_extensions: string[]
  max_size_mb: number
  max_size_bytes: number
  max_days: number
  /** Today in the upstream's business timezone, formatted YYYY-MM-DD. */
  today: string
}

export type BannerAd = {
  id: number
  title: string
  filename: string
  /** Upstream file URL; the dashboard still previews through the same-origin proxy. */
  url: string
  file_size: number
  version: number
  start_date: string
  days_to_live: number
  expires_on: string
  last_day: string
  /** "live" | "scheduled" | "expired" today; other values are passed through. */
  status: string
  days_until_start: number | null
  days_left: number | null
  /** Kiosks that have the current file downloaded. */
  kiosks_with_video: number
  /** Kiosk identifiers currently playing this advertisement. */
  playing_on: string[]
  assigned_devices: string[]
  assignment_mode: string
}

export type BannerAdsList = {
  status: string
  today: string
  kiosks_reporting: number
  ads: BannerAd[]
}

export type BannerUploadChunkResult = {
  status: string
  received: number
  total: number
  size?: number
  duplicate?: boolean
}

export type CreateBannerAdInput = {
  upload_id: string
  original_name: string
  title: string
  start_date: string
  days_to_live: number
}

export type CreateBannerAdResult = {
  status: string
  id: number
  filename: string
  message: string
}

export type UpdateBannerAdInput = {
  title: string
  start_date: string
  days_to_live: number
  /** Present only when the video is being replaced. */
  upload_id?: string
  original_name?: string
}

export type UpdateBannerAdResult = {
  status: string
  /** Upstream file version; bumped when the video is replaced. */
  version: number | null
  message: string
}

export type DeleteBannerAdResult = {
  status: string
  message: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Mothership returned an invalid ${field}`)
  return value
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Mothership returned an invalid ${field}`)
  }
  return value
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function optionalStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function errorMessage(body: unknown, status: number): string {
  if (isRecord(body)) {
    for (const key of ["error", "message", "detail"]) {
      const value = body[key]
      if (typeof value === "string" && value.trim()) return value.trim()
    }
  }
  if (status === 401) return "Your session has expired. Please log in again."
  if (status === 403) return "Only the Company Master Admin can manage Banner Ads."
  if (status === 413) return "The video is larger than Mothership accepts."
  if (status === 404) return "That advertisement no longer exists on Mothership."
  return `Banner Ads request failed (HTTP ${status})`
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  signal?: AbortSignal,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort("Mothership request timed out"), timeoutMs)
  const onAbort = () => controller.abort()
  signal?.addEventListener("abort", onAbort, { once: true })

  try {
    let response: Response
    try {
      response = await sessionApiFetch(`${BANNER_ADS_API_PATH}${path}`, {
        ...init,
        credentials: "include",
        signal: controller.signal,
      }, { silent: true })
    } catch (error) {
      if (signal?.aborted) throw error
      if (controller.signal.aborted) {
        throw new Error(`Mothership request timed out after ${Math.round(timeoutMs / 1000)} seconds`)
      }
      throw new Error(
        `Could not reach Mothership: ${error instanceof Error ? error.message : "network request failed"}`,
      )
    }

    // Error responses can be empty (the API answers 400/404 with no body), so read
    // text first and only then attempt JSON.
    const text = await response.text()
    let body: unknown = null
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        // Keep body null; errorMessage falls back to the HTTP status.
      }
    }

    if (!response.ok) throw new Error(errorMessage(body, response.status))
    return body as T
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener("abort", onAbort)
  }
}

function parseConfig(body: unknown): BannerAdsConfig {
  if (!isRecord(body) || !Array.isArray(body.allowed_extensions)) {
    throw new Error("Mothership returned an invalid Banner Ads configuration")
  }
  const extensions = body.allowed_extensions
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => (value.startsWith(".") ? value.toLowerCase() : `.${value.toLowerCase()}`))
    .filter((extension) => DASHBOARD_ALLOWED_EXTENSIONS.includes(extension))

  return {
    // Fall back to the dashboard policy if Mothership stops listing WebM, so the picker
    // still explains what it expects; an unsupported file is then rejected upstream.
    allowed_extensions: extensions.length > 0 ? extensions : [...DASHBOARD_ALLOWED_EXTENSIONS],
    max_size_mb: requiredNumber(body.max_size_mb, "maximum size"),
    max_size_bytes: requiredNumber(body.max_size_bytes, "maximum size in bytes"),
    max_days: requiredNumber(body.max_days, "maximum duration"),
    today: requiredString(body.today, "current date"),
  }
}

function parseAd(value: unknown): BannerAd {
  if (!isRecord(value)) throw new Error("Mothership returned an invalid advertisement")

  return {
    id: requiredNumber(value.id, "advertisement id"),
    title: requiredString(value.title, "advertisement title"),
    filename: requiredString(value.filename, "advertisement filename"),
    url: typeof value.url === "string" ? value.url : "",
    file_size: requiredNumber(value.file_size, "advertisement file size"),
    version: requiredNumber(value.version, "advertisement version"),
    start_date: requiredString(value.start_date, "advertisement start date"),
    days_to_live: requiredNumber(value.days_to_live, "advertisement duration"),
    expires_on: requiredString(value.expires_on, "advertisement expiry"),
    last_day: requiredString(value.last_day, "advertisement last day"),
    status: requiredString(value.status, "advertisement status"),
    days_until_start: optionalNumber(value.days_until_start),
    days_left: optionalNumber(value.days_left),
    kiosks_with_video: requiredNumber(value.kiosks_with_video, "advertisement kiosk count"),
    playing_on: optionalStringArray(value.playing_on),
    assigned_devices: optionalStringArray(value.assigned_devices),
    assignment_mode: typeof value.assignment_mode === "string" ? value.assignment_mode : "all",
  }
}

function parseList(body: unknown): BannerAdsList {
  if (!isRecord(body) || !Array.isArray(body.ads)) {
    throw new Error("Mothership returned an invalid Banner Ads list")
  }
  return {
    status: requiredString(body.status, "Banner Ads list status"),
    today: requiredString(body.today, "current date"),
    kiosks_reporting: requiredNumber(body.kiosks_reporting, "reporting kiosk count"),
    ads: body.ads.map(parseAd),
  }
}

function parseChunk(body: unknown, index: number, total: number): BannerUploadChunkResult {
  if (!isRecord(body)) throw new Error("Mothership returned an invalid upload response")
  const status = requiredString(body.status, "upload status")
  if (status !== "ok" && status !== "success") {
    throw new Error(`Mothership rejected chunk ${index + 1} of ${total}`)
  }
  const received = requiredNumber(body.received, "uploaded chunk count")
  const reportedTotal = requiredNumber(body.total, "upload chunk total")
  if (received !== index + 1 || reportedTotal !== total) {
    throw new Error(
      `Mothership stored ${received} of ${reportedTotal} chunks; expected ${index + 1} of ${total}`,
    )
  }
  return {
    status,
    received,
    total: reportedTotal,
    size: optionalNumber(body.size) ?? undefined,
    duplicate: body.duplicate === true,
  }
}

export async function fetchBannerAdsConfig(signal?: AbortSignal): Promise<BannerAdsConfig> {
  return parseConfig(await request("/config", { cache: "no-store" }, signal))
}

export async function fetchBannerAds(signal?: AbortSignal): Promise<BannerAdsList> {
  return parseList(await request("", { cache: "no-store" }, signal))
}

function createUploadId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return `bn${uuid.replaceAll("-", "").slice(0, 30)}`

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = new Uint8Array(16)
    globalThis.crypto.getRandomValues(bytes)
    return `bn${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 30)}`
  }

  return `bn${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.slice(0, 32)
}

/**
 * Uploads a video in 8 MB multipart chunks and returns the upload id that
 * POST /banner-ads (or /update) expects. The banner is never created here: the
 * caller creates it only after every chunk has been acknowledged.
 */
export async function uploadBannerAd(
  file: File,
  options: { signal?: AbortSignal; onProgress?: (percent: number) => void } = {},
): Promise<string> {
  if (file.size <= 0) throw new Error("Choose a non-empty video file.")

  const uploadId = createUploadId()
  const totalChunks = Math.max(1, Math.ceil(file.size / UPLOAD_CHUNK_BYTES))

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const start = chunkIndex * UPLOAD_CHUNK_BYTES
    const end = Math.min(start + UPLOAD_CHUNK_BYTES, file.size)
    const form = new FormData()
    form.append("upload_id", uploadId)
    form.append("chunk_index", String(chunkIndex))
    form.append("total_chunks", String(totalChunks))
    form.append("filename", file.name)
    form.append("chunk", file.slice(start, end), "piece")

    const result = await request<unknown>(
      "/upload-chunk",
      { method: "POST", body: form },
      options.signal,
      UPLOAD_TIMEOUT_MS,
    )
    parseChunk(result, chunkIndex, totalChunks)
    options.onProgress?.(Math.round(((chunkIndex + 1) / totalChunks) * 100))
  }

  return uploadId
}

export async function createBannerAd(
  input: CreateBannerAdInput,
  signal?: AbortSignal,
): Promise<CreateBannerAdResult> {
  const body = await request<unknown>(
    "",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    signal,
  )
  if (!isRecord(body)) throw new Error("Mothership returned an invalid advertisement creation response")
  return {
    status: typeof body.status === "string" ? body.status : "success",
    id: requiredNumber(body.id, "created advertisement id"),
    filename: requiredString(body.filename, "created advertisement filename"),
    message: typeof body.message === "string" ? body.message : "Advertisement created",
  }
}

export async function updateBannerAd(
  id: number,
  input: UpdateBannerAdInput,
  signal?: AbortSignal,
): Promise<UpdateBannerAdResult> {
  const body = await request<unknown>(
    `/${encodeURIComponent(id)}/update`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    signal,
  )
  if (!isRecord(body)) throw new Error("Mothership returned an invalid advertisement update response")
  return {
    status: typeof body.status === "string" ? body.status : "success",
    version: optionalNumber(body.version),
    message: typeof body.message === "string" ? body.message : "Advertisement updated",
  }
}

export async function deleteBannerAd(
  id: number,
  signal?: AbortSignal,
): Promise<DeleteBannerAdResult> {
  const body = await request<unknown>(
    `/${encodeURIComponent(id)}/delete`,
    { method: "POST" },
    signal,
  )
  if (!isRecord(body)) throw new Error("Mothership returned an invalid advertisement deletion response")
  return {
    status: typeof body.status === "string" ? body.status : "success",
    message: typeof body.message === "string" ? body.message : "Advertisement deleted",
  }
}

/** Same-origin URL for the video preview (GET /banner-ads/files/<filename>). */
export function bannerAdFileUrl(filename: string): string {
  return `${BANNER_ADS_API_PATH}/files/${encodeURIComponent(filename)}`
}
