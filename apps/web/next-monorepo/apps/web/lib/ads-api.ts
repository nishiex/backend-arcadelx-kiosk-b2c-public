/**
 * Company video ads (`/api/ads`).
 *
 * Uploads are chunked so a 500 MB video never sits in memory: init, PUT each chunk,
 * then create the ad with the upload id. The server derives the stored filename, byte
 * size and MIME type from the upload session; nothing here sends those.
 */
import { sessionApiFetch } from "./session-api"

export type AdStatus = "ACTIVE" | "INACTIVE"

export type Ad = {
  id: string
  title: string
  description: string | null
  originalFilename: string
  mimeType: string
  videoSizeBytes: number
  durationSeconds: number | null
  status: AdStatus
  videoUrl: string
  kioskIds: string[]
  createdAt: string
  updatedAt: string
}

export type AdList = {
  items: Ad[]
  page: number
  limit: number
  total: number
  totalPages: number
}

export type AdUploadConfig = {
  maxVideoSizeBytes: number
  maxChunkSizeBytes: number
  allowedMimeTypes: string[]
  allowedExtensions: string[]
}

export type AdUploadSession = {
  uploadId: string
  chunkSize: number
  totalChunks: number
  totalSize: number
  maxVideoSizeBytes: number
  expiresInMs: number
}

async function handleRes<T>(res: Response): Promise<T> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // Some failures (proxies, aborted streams) have no JSON body.
  }
  const payload = body as { data?: T; message?: string; errors?: unknown } | null
  if (!res.ok) {
    const issues = Array.isArray(payload?.errors)
      ? payload.errors
          .map((entry) => (entry && typeof entry === "object" && "message" in entry ? String(entry.message) : ""))
          .filter(Boolean)
          .join("; ")
      : ""
    throw new Error(issues || payload?.message || `Request failed (${res.status})`)
  }
  return (payload?.data ?? payload) as T
}

export async function fetchAds(params: { page?: number; limit?: number; status?: AdStatus } = {}): Promise<AdList> {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    limit: String(params.limit ?? 24),
  })
  if (params.status) query.set("status", params.status)
  const res = await sessionApiFetch(`/api/ads?${query}`, { cache: "no-store" })
  return handleRes<AdList>(res)
}

export async function fetchAdUploadConfig(): Promise<AdUploadConfig> {
  const res = await sessionApiFetch("/api/ads/config", { cache: "no-store" })
  return handleRes<AdUploadConfig>(res)
}

export async function initAdUpload(input: {
  originalFilename: string
  mimeType: string
  totalSize: number
}): Promise<AdUploadSession> {
  const res = await sessionApiFetch("/api/ads/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  return handleRes<AdUploadSession>(res)
}

export async function uploadAdChunk(uploadId: string, chunkIndex: number, chunk: Blob): Promise<void> {
  const res = await sessionApiFetch(
    `/api/ads/uploads/${encodeURIComponent(uploadId)}/chunks/${chunkIndex}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: chunk,
    },
    // One "Saving changes…" toast per chunk would bury the real progress UI.
    { silent: true },
  )
  await handleRes(res)
}

export async function discardAdUpload(uploadId: string): Promise<void> {
  const res = await sessionApiFetch(`/api/ads/uploads/${encodeURIComponent(uploadId)}`, {
    method: "DELETE",
  })
  await handleRes(res)
}

export async function createAd(input: {
  title: string
  description?: string
  uploadId: string
  kioskIds: string[]
}): Promise<Ad> {
  const res = await sessionApiFetch("/api/ads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  return handleRes<Ad>(res)
}

export async function updateAd(
  id: string,
  patch: { title?: string; description?: string | null; status?: AdStatus; kioskIds?: string[] },
): Promise<Ad> {
  const res = await sessionApiFetch(`/api/ads/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  })
  return handleRes<Ad>(res)
}

export async function deleteAd(id: string): Promise<{ id: string }> {
  const res = await sessionApiFetch(`/api/ads/${encodeURIComponent(id)}`, { method: "DELETE" })
  return handleRes<{ id: string }>(res)
}
