/**
 * Browser client for the Ads API owned by Mothership.
 *
 * This module deliberately contains no local persistence or business rules. The
 * upstream service remains the source of truth; the dashboard only validates the
 * responses and forwards the documented requests.
 */

// Requests go through the dashboard's same-origin rewrite. This avoids requiring
// Mothership to opt the dashboard origin into CORS and keeps the upstream hostname
// out of browser requests.
const MOTHERSHIP_PROXY_PATH = "/mothership-api"
const REQUEST_TIMEOUT_MS = 20_000
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024

export type MothershipAdsConfig = {
  allowed_extensions: string[]
  max_size_mb: number
  max_size_bytes: number
  max_days: number
  today: string
}

export type MothershipAd = {
  id: number
  title: string
  filename: string
  url: string
  file_size: number
  version: number
  start_date: string
  days_to_live: number
  expires_on: string
  last_day: string
  status: "live" | "scheduled" | "expired" | string
  days_until_start: number
  days_left: number
  kiosks_with_video: number
  playing_on: string[]
  assigned_devices: string[]
  assignment_mode: "all" | "selected" | string
}

export type MothershipAdsList = {
  status: string
  today: string
  kiosks_reporting: number
  ads: MothershipAd[]
}

export type MothershipDeviceAd = {
  file: string
  title: string
  size: number | null
  version: number | null
  managed: boolean
  start_date: string | null
  expires_on: string | null
}

export type MothershipDevice = {
  device_id: string
  hardware_uuid: string | null
  is_online: boolean
  kiosk_number: number | null
  last_seen: string | null
  location: string | null
  public_ip: string | null
  ads: MothershipDeviceAd[]
}

export type MothershipUploadChunkResult = {
  status: string
  received: number
  total: number
  size?: number
  duplicate?: boolean
}

export type MothershipCreateAdInput = {
  upload_id: string
  original_name: string
  title: string
  start_date: string
  days_to_live: number
}

export type MothershipCreateAdResult = {
  status: string
  id: number
  filename: string
  message: string
}

export type MothershipUpdateAdInput = {
  title: string
  start_date: string
  days_to_live: number
  upload_id?: string
  original_name?: string
}

export type MothershipUpdateAdResult = {
  status: string
  version: number
  message: string
}

export type MothershipMutationResult = {
  status: string
  message: string
}

export type UploadProgress = (percent: number) => void

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Mothership returned an invalid ${field}`)
  return value
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Mothership returned an invalid ${field}`)
  return value
}

async function requestJson<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort("Mothership request timed out"), REQUEST_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  signal?.addEventListener("abort", onAbort, { once: true })

  try {
    let response: Response
    try {
      response = await fetch(`${MOTHERSHIP_PROXY_PATH}${path}`, {
        ...init,
        credentials: "omit",
        signal: controller.signal,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      if (controller.signal.aborted) throw new Error("Mothership request timed out after 20 seconds")
      throw new Error(`Could not reach Mothership: ${error instanceof Error ? error.message : "network request failed"}`)
    }
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      // The error below includes the HTTP status when upstream did not return JSON.
    }
    if (!response.ok) {
      const message = isRecord(body) && typeof body.error === "string"
        ? body.error
        : `Mothership request failed (HTTP ${response.status})`
      throw new Error(message)
    }
    return body as T
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener("abort", onAbort)
  }
}

function parseConfig(body: unknown): MothershipAdsConfig {
  if (!isRecord(body) || !Array.isArray(body.allowed_extensions)) throw new Error("Mothership returned an invalid Ads configuration")
  return {
    allowed_extensions: body.allowed_extensions.map((value) => requiredString(value, "allowed extension")),
    max_size_mb: requiredNumber(body.max_size_mb, "maximum size"),
    max_size_bytes: requiredNumber(body.max_size_bytes, "maximum size in bytes"),
    max_days: requiredNumber(body.max_days, "maximum days"),
    today: requiredString(body.today, "current date"),
  }
}

function parseAd(value: unknown): MothershipAd {
  if (!isRecord(value)) throw new Error("Mothership returned an invalid advertisement")
  return {
    id: requiredNumber(value.id, "advertisement id"),
    title: requiredString(value.title, "advertisement title"),
    filename: requiredString(value.filename, "advertisement filename"),
    url: requiredString(value.url, "advertisement URL"),
    file_size: requiredNumber(value.file_size, "advertisement file size"),
    version: requiredNumber(value.version, "advertisement version"),
    start_date: requiredString(value.start_date, "advertisement start date"),
    days_to_live: requiredNumber(value.days_to_live, "advertisement duration"),
    expires_on: requiredString(value.expires_on, "advertisement expiry"),
    last_day: requiredString(value.last_day, "advertisement last day"),
    status: requiredString(value.status, "advertisement status"),
    days_until_start: requiredNumber(value.days_until_start, "advertisement start countdown"),
    days_left: requiredNumber(value.days_left, "advertisement remaining days"),
    kiosks_with_video: requiredNumber(value.kiosks_with_video, "assigned kiosk count"),
    playing_on: Array.isArray(value.playing_on) ? value.playing_on.map((item) => requiredString(item, "playing kiosk")) : [],
    assigned_devices: Array.isArray(value.assigned_devices) ? value.assigned_devices.map((item) => requiredString(item, "assigned kiosk")) : [],
    assignment_mode: typeof value.assignment_mode === "string" ? value.assignment_mode : "all",
  }
}

function parseAdsList(body: unknown): MothershipAdsList {
  if (!isRecord(body) || !Array.isArray(body.ads)) throw new Error("Mothership returned an invalid Ads list")
  return {
    status: requiredString(body.status, "Ads list status"),
    today: requiredString(body.today, "current date"),
    kiosks_reporting: requiredNumber(body.kiosks_reporting, "reporting kiosk count"),
    ads: body.ads.map(parseAd),
  }
}

function parseDeviceAd(value: unknown): MothershipDeviceAd {
  if (!isRecord(value)) throw new Error("Mothership returned an invalid kiosk advertisement")
  return {
    file: requiredString(value.file, "kiosk advertisement filename"),
    title: typeof value.title === "string" ? value.title : requiredString(value.file, "kiosk advertisement title"),
    size: typeof value.size === "number" ? value.size : null,
    version: typeof value.version === "number" ? value.version : null,
    managed: value.managed === true,
    start_date: typeof value.start_date === "string" ? value.start_date : null,
    expires_on: typeof value.expires_on === "string" ? value.expires_on : null,
  }
}

function parseDevice(value: unknown): MothershipDevice {
  if (!isRecord(value)) throw new Error("Mothership returned an invalid kiosk")
  return {
    device_id: requiredString(value.device_id, "kiosk id"),
    hardware_uuid: typeof value.hardware_uuid === "string" ? value.hardware_uuid : null,
    is_online: value.is_online === true,
    kiosk_number: typeof value.kiosk_number === "number" ? value.kiosk_number : null,
    last_seen: typeof value.last_seen === "string" ? value.last_seen : null,
    location: typeof value.location === "string" ? value.location : null,
    public_ip: typeof value.public_ip === "string" ? value.public_ip : null,
    ads: Array.isArray(value.ads) ? value.ads.map(parseDeviceAd) : [],
  }
}

export async function fetchMothershipAdsConfig(signal?: AbortSignal): Promise<MothershipAdsConfig> {
  return parseConfig(await requestJson("/api/v1/ads/config", { cache: "no-store" }, signal))
}

export async function fetchMothershipAds(signal?: AbortSignal): Promise<MothershipAdsList> {
  return parseAdsList(await requestJson("/api/v1/ads", { cache: "no-store" }, signal))
}

export async function fetchMothershipDevices(signal?: AbortSignal): Promise<MothershipDevice[]> {
  const body = await requestJson<unknown>("/api/v1/devices", { cache: "no-store" }, signal)
  if (!isRecord(body) || !Array.isArray(body.devices)) throw new Error("Mothership returned an invalid kiosk list")
  return body.devices.map(parseDevice)
}

export async function uploadMothershipAd(
  file: File,
  signal?: AbortSignal,
  onProgress?: UploadProgress,
): Promise<string> {
  const uploadId = `up${crypto.randomUUID().replaceAll("-", "").slice(0, 30)}`
  const totalChunks = Math.max(1, Math.ceil(file.size / UPLOAD_CHUNK_BYTES))

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const form = new FormData()
    form.append("upload_id", uploadId)
    form.append("chunk_index", String(chunkIndex))
    form.append("total_chunks", String(totalChunks))
    form.append("filename", file.name)
    form.append("chunk", file.slice(chunkIndex * UPLOAD_CHUNK_BYTES, (chunkIndex + 1) * UPLOAD_CHUNK_BYTES), "piece")

    const result = await requestJson<unknown>("/api/v1/ads/upload-chunk", { method: "POST", body: form }, signal)
    if (!isRecord(result) || result.status !== "ok" || result.received !== chunkIndex + 1 || result.total !== totalChunks) {
      throw new Error("Mothership returned an invalid upload progress response")
    }
    onProgress?.(Math.round(((chunkIndex + 1) / totalChunks) * 100))
  }
  return uploadId
}

export async function createMothershipAd(input: MothershipCreateAdInput, signal?: AbortSignal): Promise<MothershipCreateAdResult> {
  const body = await requestJson<unknown>("/api/v1/ads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }, signal)
  if (!isRecord(body)) throw new Error("Mothership returned an invalid advertisement creation response")
  return {
    status: requiredString(body.status, "creation status"),
    id: requiredNumber(body.id, "created advertisement id"),
    filename: requiredString(body.filename, "created advertisement filename"),
    message: requiredString(body.message, "creation message"),
  }
}

export async function updateMothershipAd(id: number, input: MothershipUpdateAdInput, signal?: AbortSignal): Promise<MothershipUpdateAdResult> {
  const body = await requestJson<unknown>(`/api/v1/ads/${encodeURIComponent(id)}/update`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }, signal)
  if (!isRecord(body)) throw new Error("Mothership returned an invalid advertisement update response")
  return {
    status: requiredString(body.status, "update status"),
    version: requiredNumber(body.version, "updated advertisement version"),
    message: requiredString(body.message, "update message"),
  }
}

export async function assignMothershipAd(id: number, deviceIds: string[], signal?: AbortSignal): Promise<{ status: string; ad_id: number; device_ids: string[]; assignment_mode: string; message: string }> {
  const body = await requestJson<unknown>(`/api/v1/ads/${encodeURIComponent(id)}/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device_ids: deviceIds }) }, signal)
  if (!isRecord(body)) throw new Error("Mothership returned an invalid assignment response")
  return {
    status: requiredString(body.status, "assignment status"),
    ad_id: requiredNumber(body.ad_id, "assigned advertisement id"),
    device_ids: Array.isArray(body.device_ids) ? body.device_ids.map((item) => requiredString(item, "assigned kiosk")) : [],
    assignment_mode: requiredString(body.assignment_mode, "assignment mode"),
    message: requiredString(body.message, "assignment message"),
  }
}

export async function deleteMothershipAd(id: number, signal?: AbortSignal): Promise<MothershipMutationResult> {
  const body = await requestJson<unknown>(`/api/v1/ads/${encodeURIComponent(id)}/delete`, { method: "POST" }, signal)
  if (!isRecord(body)) throw new Error("Mothership returned an invalid advertisement deletion response")
  return {
    status: requiredString(body.status, "deletion status"),
    message: requiredString(body.message, "deletion message"),
  }
}

export function mothershipAdFileUrl(filename: string): string {
  return `${MOTHERSHIP_PROXY_PATH}/api/v1/ads/files/${encodeURIComponent(filename)}`
}
