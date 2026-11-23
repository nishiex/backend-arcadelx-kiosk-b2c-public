const MOTHERSHIP_PROXY_PATH = "/mothership-api"
const CHUNK_BYTES = 8 * 1024 * 1024

export type BannerAdsConfig = { allowed_extensions: string[]; max_size_mb: number; max_size_bytes: number; max_days: number; today: string }
export type BannerAd = { id: number; title: string; filename: string; url: string; file_size: number; version: number; start_date: string; days_to_live: number; expires_on: string; last_day: string; status: string; kiosks_with_video: number; playing_on: string[] }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${MOTHERSHIP_PROXY_PATH}${path}`, { ...init, credentials: "omit" })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : `Banner Ads request failed (HTTP ${response.status})`)
  return body as T
}

export const fetchBannerAdsConfig = () => request<BannerAdsConfig>("/api/v1/banner-ads/config", { cache: "no-store" })
export const fetchBannerAds = () => request<{ status: string; today: string; kiosks_reporting: number; ads: BannerAd[] }>("/api/v1/banner-ads", { cache: "no-store" })
export const createBannerAd = (input: Record<string, unknown>) => request<{ id: number; filename: string; message: string }>("/api/v1/banner-ads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })
export const updateBannerAd = (id: number, input: Record<string, unknown>) => request<{ version: number; message: string }>(`/api/v1/banner-ads/${id}/update`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })
export const deleteBannerAd = (id: number) => request<{ message: string }>(`/api/v1/banner-ads/${id}/delete`, { method: "POST" })
export const bannerAdFileUrl = (filename: string) => `${MOTHERSHIP_PROXY_PATH}/api/v1/banner-ads/files/${encodeURIComponent(filename)}`

export async function uploadBannerAd(file: File, onProgress?: (percent: number) => void) {
  const uploadId = `bn${crypto.randomUUID().replaceAll("-", "").slice(0, 30)}`
  const total = Math.max(1, Math.ceil(file.size / CHUNK_BYTES))
  for (let index = 0; index < total; index += 1) {
    const form = new FormData()
    form.append("upload_id", uploadId); form.append("chunk_index", String(index)); form.append("total_chunks", String(total)); form.append("filename", file.name); form.append("chunk", file.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES), "piece")
    await request(`/api/v1/banner-ads/upload-chunk`, { method: "POST", body: form })
    onProgress?.(Math.round(((index + 1) / total) * 100))
  }
  return uploadId
}
