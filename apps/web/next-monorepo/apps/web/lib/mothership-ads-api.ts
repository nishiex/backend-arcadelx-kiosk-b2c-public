/** Client for regular Ads. Banner Ads use mothership-banner-ads-api.ts instead. */
import { sessionApiFetch } from "@/lib/session-api"
const API_PATH = "/api/ads"
const REQUEST_TIMEOUT_MS = 20_000
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024

export type MothershipAdsConfig = { allowed_extensions: string[]; max_size_mb: number; max_size_bytes: number; max_days: number; today: string }
export type MothershipAd = {
  id: number; title: string; filename: string; url: string; file_size: number; version: number
  start_date: string; days_to_live: number; expires_on: string; last_day: string
  status: string; days_until_start: number | null; days_left: number | null
  kiosks_with_video: number; playing_on: string[]; assigned_devices: string[]; assignment_mode: string
}
export type MothershipAdsList = { status: string; today: string; kiosks_reporting: number; ads: MothershipAd[] }
export type MothershipDeviceAd = { file: string; title: string; size: number | null; version: number | null; managed: boolean; start_date: string | null; expires_on: string | null }
export type MothershipDevice = { device_id: string; hardware_uuid: string | null; is_online: boolean; kiosk_number: number | null; last_seen: string | null; location: string | null; public_ip: string | null; ads: MothershipDeviceAd[] }
export type MothershipCreateAdInput = { upload_id: string; original_name: string; title: string; start_date: string; days_to_live: number }
export type MothershipCreateAdResult = { status: string; id: number; filename: string; message: string }
export type MothershipUpdateAdInput = { title: string; start_date: string; days_to_live: number; upload_id?: string; original_name?: string }
export type MothershipUpdateAdResult = { status: string; version: number | null; message: string }

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function requiredString(value: unknown, field: string): string { if (typeof value !== "string") throw new Error(`Mothership returned an invalid ${field}`); return value }
function requiredNumber(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Mothership returned an invalid ${field}`); return value }
function optionalNumber(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [] }

async function request<T>(path: string, init: RequestInit = {}, signal?: AbortSignal, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  const onAbort = () => controller.abort()
  signal?.addEventListener("abort", onAbort, { once: true })
  try {
    let response: Response
    try { response = await sessionApiFetch(`${API_PATH}${path}`, { ...init, credentials: "include", signal: controller.signal }, { silent: true }) }
    catch (error) { throw new Error(controller.signal.aborted ? "Regular Ads request timed out." : `Could not reach regular Ads: ${error instanceof Error ? error.message : "network request failed"}`) }
    const text = await response.text()
    let body: unknown = null
    if (text) { try { body = JSON.parse(text) } catch { /* use status fallback */ } }
    if (!response.ok) {
      const message = isRecord(body) ? [body.error, body.message, body.detail].find((v): v is string => typeof v === "string" && v.trim().length > 0) : undefined
      throw new Error(message ?? `Regular Ads request failed (HTTP ${response.status})`)
    }
    return body as T
  } finally { window.clearTimeout(timer); signal?.removeEventListener("abort", onAbort) }
}

function parseAd(value: unknown): MothershipAd {
  if (!isRecord(value)) throw new Error("Mothership returned an invalid regular advertisement")
  return {
    id: requiredNumber(value.id, "advertisement id"), title: requiredString(value.title, "advertisement title"), filename: requiredString(value.filename, "advertisement filename"), url: typeof value.url === "string" ? value.url : "", file_size: requiredNumber(value.file_size, "advertisement size"), version: requiredNumber(value.version, "advertisement version"), start_date: requiredString(value.start_date, "advertisement start date"), days_to_live: requiredNumber(value.days_to_live, "advertisement duration"), expires_on: requiredString(value.expires_on, "advertisement expiry"), last_day: requiredString(value.last_day, "advertisement last day"), status: requiredString(value.status, "advertisement status"), days_until_start: optionalNumber(value.days_until_start), days_left: optionalNumber(value.days_left), kiosks_with_video: requiredNumber(value.kiosks_with_video, "kiosk count"), playing_on: strings(value.playing_on), assigned_devices: strings(value.assigned_devices), assignment_mode: typeof value.assignment_mode === "string" ? value.assignment_mode : "all",
  }
}
function parseList(value: unknown): MothershipAdsList { if (!isRecord(value) || !Array.isArray(value.ads)) throw new Error("Mothership returned an invalid regular Ads list"); return { status: requiredString(value.status, "Ads status"), today: requiredString(value.today, "current date"), kiosks_reporting: requiredNumber(value.kiosks_reporting, "kiosk count"), ads: value.ads.map(parseAd) } }

export async function fetchMothershipAdsConfig(signal?: AbortSignal): Promise<MothershipAdsConfig> { return request("/config", { cache: "no-store" }, signal) }
export async function fetchMothershipAds(signal?: AbortSignal): Promise<MothershipAdsList> { return parseList(await request("", { cache: "no-store" }, signal)) }
export async function fetchMothershipDevices(signal?: AbortSignal): Promise<MothershipDevice[]> {
  const response = await sessionApiFetch("/api/devices", { cache: "no-store", credentials: "include", signal }, { silent: true })
  const body = await response.json().catch(() => null) as unknown
  const envelope = isRecord(body) && isRecord(body.data) ? body.data : body
  if (!response.ok || !isRecord(envelope) || !Array.isArray(envelope.devices)) throw new Error("Mothership returned an invalid kiosk list")
  return envelope.devices.map((value) => {
    if (!isRecord(value)) throw new Error("Mothership returned an invalid kiosk")
    return {
      device_id: requiredString(value.deviceId ?? value.device_id, "kiosk id"),
      hardware_uuid: typeof (value.hardwareUuid ?? value.hardware_uuid) === "string" ? (value.hardwareUuid ?? value.hardware_uuid) as string : null,
      is_online: value.isOnline === true || value.is_online === true,
      kiosk_number: typeof (value.kioskNumber ?? value.kiosk_number) === "number" ? (value.kioskNumber ?? value.kiosk_number) as number : null,
      last_seen: typeof (value.lastSeen ?? value.last_seen) === "string" ? (value.lastSeen ?? value.last_seen) as string : null,
      location: typeof value.location === "string" ? value.location : null,
      public_ip: typeof (value.publicIp ?? value.public_ip) === "string" ? (value.publicIp ?? value.public_ip) as string : null,
      ads: Array.isArray(value.ads) ? value.ads as MothershipDeviceAd[] : [],
    }
  })
}
function uploadId() { return `up${globalThis.crypto?.randomUUID?.()?.replaceAll("-", "").slice(0, 30) ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.slice(0, 30)}` }
export async function uploadMothershipAd(file: File, _signal?: AbortSignal, onProgress?: (percent: number) => void): Promise<string> {
  if (file.size <= 0) throw new Error("Choose a non-empty video file.")
  const id = uploadId(); const total = Math.max(1, Math.ceil(file.size / UPLOAD_CHUNK_BYTES))
  for (let index = 0; index < total; index += 1) {
    const form = new FormData(); form.append("upload_id", id); form.append("chunk_index", String(index)); form.append("total_chunks", String(total)); form.append("filename", file.name); form.append("chunk", file.slice(index * UPLOAD_CHUNK_BYTES, (index + 1) * UPLOAD_CHUNK_BYTES), "piece")
    const result = await request<unknown>("/upload-chunk", { method: "POST", body: form }, _signal, 120_000)
    if (!isRecord(result) || result.status !== "ok" || result.received !== index + 1 || result.total !== total) throw new Error(`Mothership rejected chunk ${index + 1} of ${total}`)
    onProgress?.(Math.round(((index + 1) / total) * 100))
  }
  return id
}
export async function createMothershipAd(input: MothershipCreateAdInput): Promise<MothershipCreateAdResult> { return request("", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }) }
export async function updateMothershipAd(id: number, input: MothershipUpdateAdInput): Promise<MothershipUpdateAdResult> { return request(`/${encodeURIComponent(id)}/update`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }) }
export async function assignMothershipAd(id: number, deviceIds: string[]): Promise<{ status: string; message: string }> { return request(`/${encodeURIComponent(id)}/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device_ids: deviceIds }) }) }
export async function deleteMothershipAd(id: number): Promise<{ status: string; message: string }> { return request(`/${encodeURIComponent(id)}/delete`, { method: "POST" }) }
export function mothershipAdFileUrl(filename: string): string { return `${API_PATH}/files/${encodeURIComponent(filename)}` }
