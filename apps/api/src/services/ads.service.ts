/**
 * Ads video storage.
 *
 * Uploads are chunked and resumable. A server-minted `uploadId` names two files in the
 * temp directory: `<uploadId>.json` (the session: owner, declared size, chunk bookkeeping)
 * and `<uploadId>.part` (the bytes). Chunks are written at `chunkIndex * chunkSize`, so a
 * retried or out-of-order chunk cannot duplicate or shift the file, and the final rename
 * only happens after every chunk is present and the size matches the declared total.
 *
 * Files are only ever addressed by names this module minted. `assertStoredFilename` is the
 * single choke point: no caller-supplied path can escape the storage directory.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';

// ── Limits and allowlists ───────────────────────────────────────────────────────

const DEFAULT_MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500 MB
const DEFAULT_MAX_CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_COLUMN_BYTES = 2_000_000_000; // Ad.videoSizeBytes is a 32-bit INTEGER
const MAX_FILENAME_LENGTH = 255;
const MAX_CHUNKS = 100_000;
const UPLOAD_TTL_MS = 6 * 60 * 60 * 1000;

/** Accepted MIME types for ad videos. */
export const ALLOWED_VIDEO_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime', // .mov
  'video/x-msvideo', // .avi
  'video/x-matroska', // .mkv
] as const;

/** Accepted extensions, mapped from the MIME types above. */
const MIME_EXTENSIONS: Record<string, readonly string[]> = {
  'video/mp4': ['.mp4'],
  'video/webm': ['.webm'],
  'video/quicktime': ['.mov'],
  'video/x-msvideo': ['.avi'],
  'video/x-matroska': ['.mkv'],
};

export const ALLOWED_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi', '.mkv'] as const;

// ── Configuration ───────────────────────────────────────────────────────────────

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new ApiError(503, 'Invalid ads storage configuration');
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ApiError(503, 'Invalid ads storage configuration');
  }
  return value;
}

export function maxVideoSizeBytes(): number {
  const value = positiveInt(env.ADS_MAX_VIDEO_SIZE, DEFAULT_MAX_VIDEO_SIZE);
  if (value > MAX_COLUMN_BYTES) {
    throw new ApiError(503, 'ADS_MAX_VIDEO_SIZE exceeds the 2 GB storage column limit');
  }
  return value;
}

export function maxChunkSizeBytes(): number {
  return positiveInt(env.ADS_MAX_CHUNK_SIZE, DEFAULT_MAX_CHUNK_SIZE);
}

/**
 * Root directory for finished ad videos.
 *
 * In production an absolute path on persistent storage is mandatory: the local default
 * sits inside the application directory, which is read-only (Vercel) or discarded with
 * the container (Docker). Failing here, at first use, keeps an unrelated deploy from
 * crashing at import time while still refusing to pretend storage works.
 */
export function adsUploadDir(): string {
  const configured = env.ADS_UPLOAD_DIR?.trim();
  if (configured) {
    if (!path.isAbsolute(configured)) {
      throw new ApiError(503, 'ADS_UPLOAD_DIR must be an absolute path');
    }
    return path.resolve(configured);
  }
  if (env.NODE_ENV === 'production') {
    throw new ApiError(503, 'Ad storage is not configured (ADS_UPLOAD_DIR)');
  }
  return path.resolve(import.meta.dirname, '..', '..', 'uploads', 'ads');
}

function tempDir(): string {
  return path.join(adsUploadDir(), '.tmp');
}

/**
 * Map a filesystem failure onto the status it really is.
 *
 * A directory the container user cannot write is a deployment error, not a bug in the
 * request: answering 500 hides that and sends the operator looking in the wrong place. The
 * path and the OS code are both included because they name the fix.
 */
function storageFailure(error: unknown, target: string): never {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code && ['EACCES', 'EPERM', 'EROFS', 'ENOSPC', 'ENOTDIR'].includes(code)) {
    throw new ApiError(
      503,
      `Ad storage is not writable at ${target} (${code}); point ADS_UPLOAD_DIR at a writable directory`,
    );
  }
  throw error;
}

let ensuredRoot: string | null = null;

/** Create the storage directories on demand. No filesystem work happens at import. */
export async function ensureStorageReady(): Promise<void> {
  const root = adsUploadDir();
  if (ensuredRoot === root) return;
  try {
    await fsp.mkdir(tempDir(), { recursive: true });
  } catch (error) {
    storageFailure(error, tempDir());
  }
  ensuredRoot = root;
}

// ── Filenames ───────────────────────────────────────────────────────────────────

/** `<uuid>-<epoch ms>.<ext>` — exactly what `generateStoredFilename` mints, nothing else. */
const STORED_FILENAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-\d{1,16}\.(mp4|webm|mov|avi|mkv)$/i;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertStoredFilename(filename: string): string {
  if (filename !== path.basename(filename) || !STORED_FILENAME_RE.test(filename)) {
    throw new ApiError(400, 'Invalid video filename');
  }
  return filename;
}

/** Build the final stored path. Rejects anything this module did not mint. */
export function storedVideoPath(filename: string): string {
  return path.join(adsUploadDir(), assertStoredFilename(filename));
}

/**
 * Generate a collision-free stored filename preserving the validated extension.
 * Format: `<uuid>-<timestamp>.<ext>`
 */
export function generateStoredFilename(extension: string): string {
  const ext = extension.toLowerCase();
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new ApiError(415, 'Unsupported video extension');
  }
  return `${crypto.randomUUID()}-${Date.now()}${ext}`;
}

// ── Upload sessions ─────────────────────────────────────────────────────────────

type UploadSession = {
  uploadId: string;
  organizationId: string;
  userId: string;
  originalFilename: string;
  mimeType: string;
  extension: string;
  totalSize: number;
  chunkSize: number;
  totalChunks: number;
  received: number[];
  createdAt: string;
};

type UploadActor = {
  organizationId: string;
  userId: string;
};

function assertUploadId(uploadId: string): string {
  if (!UUID_RE.test(uploadId)) throw new ApiError(400, 'Invalid uploadId');
  return uploadId;
}

function sessionPath(uploadId: string): string {
  return path.join(tempDir(), `${assertUploadId(uploadId)}.json`);
}

function partPath(uploadId: string): string {
  return path.join(tempDir(), `${assertUploadId(uploadId)}.part`);
}

async function readSession(uploadId: string): Promise<UploadSession> {
  try {
    const raw = await fsp.readFile(sessionPath(uploadId), 'utf8');
    return JSON.parse(raw) as UploadSession;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ApiError(404, 'Upload session not found or expired');
    }
    throw error;
  }
}

/** A session belongs to exactly one member of one organization. */
function assertOwner(session: UploadSession, actor: UploadActor): void {
  if (
    session.organizationId !== actor.organizationId ||
    session.userId !== actor.userId
  ) {
    // 404, not 403: another tenant's upload must not be confirmed to exist.
    throw new ApiError(404, 'Upload session not found or expired');
  }
}

async function writeSession(session: UploadSession): Promise<void> {
  const target = sessionPath(session.uploadId);
  const temp = `${target}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(temp, JSON.stringify(session), 'utf8');
  await fsp.rename(temp, target);
}

export type UploadInitInput = UploadActor & {
  originalFilename: string;
  mimeType: string;
  totalSize: number;
};

/**
 * Start an upload. The size, MIME type and extension are all fixed here; later chunk
 * calls cannot change them.
 */
export async function initUpload(input: UploadInitInput): Promise<{
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
  totalSize: number;
  maxVideoSizeBytes: number;
  expiresInMs: number;
}> {
  await ensureStorageReady();

  const limit = maxVideoSizeBytes();
  const totalSize = Math.trunc(input.totalSize);
  if (!Number.isSafeInteger(totalSize) || totalSize <= 0) {
    throw new ApiError(400, 'Video size must be a positive number of bytes');
  }
  if (totalSize > limit) {
    throw new ApiError(413, `Video exceeds the ${limit} byte limit`);
  }

  const mimeType = input.mimeType.trim().toLowerCase();
  const extensions = MIME_EXTENSIONS[mimeType];
  if (!extensions) throw new ApiError(415, 'Unsupported video type');

  const originalFilename = path
    .basename(input.originalFilename)
    .replace(/[\u0000-\u001f]/g, '')
    .trim();
  if (!originalFilename || originalFilename.length > MAX_FILENAME_LENGTH) {
    throw new ApiError(400, 'Invalid filename');
  }
  const extension = path.extname(originalFilename).toLowerCase() || extensions[0]!;
  if (!extensions.includes(extension)) {
    throw new ApiError(415, 'File extension does not match the video type');
  }

  const chunkSize = maxChunkSizeBytes();
  const totalChunks = Math.ceil(totalSize / chunkSize);
  if (totalChunks > MAX_CHUNKS) {
    throw new ApiError(413, 'Video needs too many chunks; raise ADS_MAX_CHUNK_SIZE');
  }

  const uploadId = crypto.randomUUID();
  const session: UploadSession = {
    uploadId,
    organizationId: input.organizationId,
    userId: input.userId,
    originalFilename,
    mimeType,
    extension,
    totalSize,
    chunkSize,
    totalChunks,
    received: [],
    createdAt: new Date().toISOString(),
  };

  try {
    await fsp.writeFile(partPath(uploadId), Buffer.alloc(0), { flag: 'wx' });
  } catch (error) {
    storageFailure(error, adsUploadDir());
  }
  try {
    await writeSession(session);
  } catch (error) {
    await fsp.rm(partPath(uploadId), { force: true });
    throw error;
  }

  // Opportunistic housekeeping: abandoned uploads otherwise sit in the temp directory
  // forever. Failures here must never fail a new upload.
  void cleanupExpiredUploads().catch(() => undefined);

  return {
    uploadId,
    chunkSize,
    totalChunks,
    totalSize,
    maxVideoSizeBytes: limit,
    expiresInMs: UPLOAD_TTL_MS,
  };
}

export type ChunkInput = UploadActor & {
  uploadId: string;
  chunkIndex: number;
  chunk: Buffer;
};

/**
 * Write one chunk at its exact offset. Idempotent for a retried chunk, and tolerant of
 * out-of-order delivery, because position comes from `chunkIndex`, not arrival order.
 */
export async function writeChunk(input: ChunkInput): Promise<{
  uploadId: string;
  receivedChunks: number;
  totalChunks: number;
  /** Echoed so a single-call client can size its next request without reading the session. */
  chunkSize: number;
  totalSize: number;
  complete: boolean;
}> {
  await ensureStorageReady();
  const session = await readSession(input.uploadId);
  assertOwner(session, input);

  const { chunkIndex, chunk } = input;
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.totalChunks) {
    throw new ApiError(400, 'chunkIndex is out of range');
  }
  const offset = chunkIndex * session.chunkSize;
  const expected = chunkIndex === session.totalChunks - 1
    ? session.totalSize - offset
    : session.chunkSize;
  if (chunk.length !== expected) {
    throw new ApiError(400, `Expected ${expected} bytes for chunk ${chunkIndex}, received ${chunk.length}`);
  }

  const handle = await fsp.open(partPath(session.uploadId), 'r+').catch((error: unknown) =>
    storageFailure(error, adsUploadDir()),
  );
  try {
    const { bytesWritten } = await handle.write(chunk, 0, chunk.length, offset);
    if (bytesWritten !== chunk.length) {
      throw new ApiError(500, 'Short write while storing the video chunk');
    }
  } finally {
    await handle.close();
  }

  if (!session.received.includes(chunkIndex)) {
    session.received.push(chunkIndex);
    await writeSession(session);
  }

  return {
    uploadId: session.uploadId,
    receivedChunks: session.received.length,
    totalChunks: session.totalChunks,
    chunkSize: session.chunkSize,
    totalSize: session.totalSize,
    complete: session.received.length === session.totalChunks,
  };
}

export type CompleteInput = UploadActor & { uploadId: string };

/**
 * Verify completeness, then move the temp file into the served directory.
 * Returns the metadata the Ad row must be created from — never client-supplied values.
 */
export async function completeUpload(input: CompleteInput): Promise<{
  videoFilename: string;
  originalFilename: string;
  mimeType: string;
  videoSizeBytes: number;
}> {
  await ensureStorageReady();
  const session = await readSession(input.uploadId);
  assertOwner(session, input);

  if (session.received.length !== session.totalChunks) {
    throw new ApiError(
      409,
      `Upload incomplete: ${session.received.length}/${session.totalChunks} chunks received`,
    );
  }

  const part = partPath(session.uploadId);
  const stat = await fsp.stat(part);
  if (stat.size !== session.totalSize) {
    // The file can never become valid, so do not let it linger.
    await discardUpload(input);
    throw new ApiError(409, 'Uploaded size does not match the declared size');
  }

  const videoFilename = generateStoredFilename(session.extension);
  try {
    await fsp.rename(part, path.join(adsUploadDir(), videoFilename));
  } catch (error) {
    storageFailure(error, adsUploadDir());
  }
  await fsp.rm(sessionPath(session.uploadId), { force: true });

  return {
    videoFilename,
    originalFilename: session.originalFilename,
    mimeType: session.mimeType,
    videoSizeBytes: session.totalSize,
  };
}

/** Abandon an upload: the caller may retry the same uploadId or start over. */
export async function discardUpload(input: CompleteInput): Promise<void> {
  const session = await readSession(input.uploadId).catch(() => null);
  if (!session) return;
  assertOwner(session, input);
  await fsp.rm(partPath(session.uploadId), { force: true });
  await fsp.rm(sessionPath(session.uploadId), { force: true });
}

/** Delete a stored video. Only "already gone" is ignored; real I/O failures surface. */
export async function deleteVideoFile(filename: string): Promise<void> {
  try {
    await fsp.unlink(storedVideoPath(filename));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/** Size and path of a stored video, for range-aware serving. Throws 404 if missing. */
export async function statVideo(filename: string): Promise<{ filePath: string; size: number }> {
  const filePath = storedVideoPath(filename);
  try {
    const stat = await fsp.stat(filePath);
    return { filePath, size: stat.size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ApiError(404, 'Video file not found');
    }
    throw error;
  }
}

/** Remove upload sessions older than `maxAgeMs`. Returns how many were removed. */
export async function cleanupExpiredUploads(maxAgeMs: number = UPLOAD_TTL_MS): Promise<number> {
  await ensureStorageReady();
  const dir = tempDir();
  const cutoff = Date.now() - maxAgeMs;
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return 0;
  }

  let removed = 0;
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const full = path.join(dir, name);
    try {
      const session = JSON.parse(await fsp.readFile(full, 'utf8')) as UploadSession;
      if (Date.parse(session.createdAt) > cutoff) continue;
      await fsp.rm(partPath(session.uploadId), { force: true });
      await fsp.rm(full, { force: true });
      removed += 1;
    } catch {
      // Unreadable or half-written sidecar: leave it for the next sweep.
    }
  }
  return removed;
}

/** Configuration for the frontend uploader. */
export function getUploadConfig(): {
  maxVideoSizeBytes: number;
  maxChunkSizeBytes: number;
  allowedMimeTypes: string[];
  allowedExtensions: string[];
} {
  return {
    maxVideoSizeBytes: maxVideoSizeBytes(),
    maxChunkSizeBytes: maxChunkSizeBytes(),
    allowedMimeTypes: [...ALLOWED_VIDEO_TYPES],
    allowedExtensions: [...ALLOWED_EXTENSIONS],
  };
}
