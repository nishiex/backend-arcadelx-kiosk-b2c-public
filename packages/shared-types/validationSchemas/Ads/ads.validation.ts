import { z } from 'zod';

// Ads media is uploaded first, in resumable chunks. The create call finalises the upload,
// so the client never supplies a stored filename, byte size or MIME type: those are taken
// from the upload session the server created (see services/ads.service.ts).

const KioskIdListSchema = z.array(z.string().uuid()).max(1000);

export const CreateAdSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  description: z.string().trim().max(2000).optional(),
  uploadId: z.string().uuid(),
  kioskIds: KioskIdListSchema.optional().default([]),
});
export type CreateAdInput = z.infer<typeof CreateAdSchema>;

export const UpdateAdSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    // Omitted: keep the current assignments. []: detach from every kiosk.
    // [...]: replace the set with exactly these kiosks.
    kioskIds: KioskIdListSchema.optional(),
    // A finished upload session whose bytes replace this ad's video. The stored filename,
    // size and MIME type all come from that session, exactly like create — never from the
    // body. Without this field the existing video is left untouched.
    uploadId: z.string().uuid().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'No fields to update' });
export type UpdateAdInput = z.infer<typeof UpdateAdSchema>;

// ── Chunked upload ──────────────────────────────────────────────────────────────

export const UploadInitSchema = z.object({
  originalFilename: z.string().trim().min(1).max(255),
  mimeType: z.enum([
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-matroska',
  ]),
  totalSize: z.number().int().positive(),
});
export type UploadInitInput = z.infer<typeof UploadInitSchema>;

export const UploadIdParamSchema = z.object({
  uploadId: z.string().uuid(),
});

export const UploadChunkParamsSchema = z.object({
  uploadId: z.string().uuid(),
  chunkIndex: z.coerce.number().int().min(0),
});

// ── Routes ──────────────────────────────────────────────────────────────────────

export const AdIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const ListAdsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  kioskId: z.string().uuid().optional(),
});
export type ListAdsQuery = z.infer<typeof ListAdsQuerySchema>;
