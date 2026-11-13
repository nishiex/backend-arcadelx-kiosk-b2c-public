import type { Request, Response, NextFunction } from 'express';
import { Readable } from 'node:stream';
import { prisma } from '../../utils/db';
import { ApiError } from '../../utils/ApiError';
import { ApiResponse } from '../../utils/ApiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { Prisma } from '../../generated/prisma/client';
import {
  AdIdParamSchema,
  CreateAdSchema,
  ListAdsQuerySchema,
  UpdateAdSchema,
  UploadChunkParamsSchema,
  UploadIdParamSchema,
  UploadInitSchema,
} from '@shared-types/validationSchemas/Ads/ads.validation';
import * as ads from '../../services/ads.service';
import { serveAdVideo } from './ad-video';
import { networkOrgIds } from '../../services/network-scope';

// Display shape only. The stored filename is intentionally absent: clients address the
// video through /api/ads/:id/video, which re-checks organization scope on every request.
const adInclude = {
  adKiosks: { select: { kioskId: true }, orderBy: { assignedAt: 'asc' } },
} satisfies Prisma.AdInclude;

type AdWithKiosks = Prisma.AdGetPayload<{ include: typeof adInclude }>;

function actor(req: Request): { organizationId: string; userId: string } {
  const membership = req.membership;
  if (!membership) throw new ApiError(403, 'Organization membership required');
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Authentication required');
  return { organizationId: membership.organizationId, userId };
}

function toAdResponse(ad: AdWithKiosks) {
  return {
    id: ad.id,
    title: ad.title,
    description: ad.description,
    originalFilename: ad.originalFilename,
    mimeType: ad.mimeType,
    videoSizeBytes: ad.videoSizeBytes,
    durationSeconds: ad.durationSeconds,
    status: ad.status,
    videoUrl: `/api/ads/${ad.id}/video`,
    // The mobile contract plays videos as `/api/v1/ads/files/<filename>`, so the list has to
    // say which filename a row is addressed by. This is the server-minted on-disk name, not
    // a path: the files route re-checks organization scope and re-validates the shape.
    filename: ad.videoFilename,
    kioskIds: ad.adKiosks.map((link) => link.kioskId),
    createdAt: ad.createdAt,
    updatedAt: ad.updatedAt,
  };
}

async function resolveAdCompanyOrgId(req: Request): Promise<string> {
  const membership = req.membership;
  if (!membership) throw new ApiError(403, 'Organization membership required');
  if (membership.type === 'COMPANY') return membership.organizationId;

  const org = await prisma.organization.findUnique({
    where: { id: membership.organizationId },
    select: { parentOrgId: true, parentOrg: { select: { id: true, type: true, parentOrgId: true } } },
  });
  if (org?.parentOrg?.type === 'COMPANY') return org.parentOrg.id;
  if (org?.parentOrg?.parentOrgId) return org.parentOrg.parentOrgId;

  const company = await prisma.organization.findFirst({
    where: { type: 'COMPANY' },
    select: { id: true },
  });
  return company?.id ?? membership.organizationId;
}

/**
 * A kiosk can carry an ad while it is part of this Company's fleet — including directly
 * owned machines, machines assigned to child Distributors, and machines assigned to Partners
 * (whether placed directly or via Distributors).
 *
 * Preserves existing kiosk ownership, distributor/partner assignments and access permissions;
 * only RETIRED machines are excluded.
 */
async function resolveOwnedKiosks(organizationId: string, kioskIds: string[]): Promise<string[]> {
  const unique = [...new Set(kioskIds)];
  if (unique.length === 0) return [];

  // Same resolver as the kiosk inventory the picker reads, so a machine that is offered
  // there is always accepted here -- including Partners linked by connection or agreement
  // rather than by `parentOrgId`.
  const allowedOrgIds = new Set(await networkOrgIds(organizationId, 'COMPANY'));

  const kiosks = await prisma.kiosk.findMany({
    where: { id: { in: unique } },
    select: {
      id: true,
      currentOrgId: true,
      status: true,
      assignments: {
        where: { assignedTo: null },
        select: { organizationId: true },
        take: 1,
      },
    },
  });

  const eligibleKiosks = new Set(
    kiosks
      .filter((kiosk) => {
        if (!kiosk.currentOrgId) return true; // Unassigned Company stock
        if (allowedOrgIds.has(kiosk.currentOrgId)) return true;
        return kiosk.assignments.some((a) => allowedOrgIds.has(a.organizationId));
      })
      .map((kiosk) => kiosk.id),
  );

  const rejected = unique.filter((id) => !eligibleKiosks.has(id));
  if (rejected.length > 0) {
    throw new ApiError(400, `Kiosks are not owned or assigned within this organization network: ${rejected.join(', ')}`);
  }

  const retired = kiosks.filter((kiosk) => kiosk.status === 'RETIRED');
  if (retired.length > 0) {
    throw new ApiError(400, `Retired kiosks cannot receive ads: ${retired.map((kiosk) => kiosk.id).join(', ')}`);
  }

  return unique;
}

export const getUploadConfig = asyncHandler(async (_req: Request, res: Response) => {
  return res.status(200).json(new ApiResponse(200, ads.getUploadConfig(), 'Upload configuration'));
});

export const initUpload = asyncHandler(async (req: Request, res: Response) => {
  const body = UploadInitSchema.parse(req.body);
  const { organizationId, userId } = actor(req);
  const session = await ads.initUpload({ ...body, organizationId, userId });
  return res.status(201).json(new ApiResponse(201, session, 'Upload started'));
});

export const uploadChunk = asyncHandler(async (req: Request, res: Response) => {
  const { uploadId, chunkIndex } = UploadChunkParamsSchema.parse(req.params);
  const { organizationId, userId } = actor(req);

  // express.raw() only produces a Buffer for application/octet-stream; anything else
  // reaches here unparsed (or parsed as JSON), and must not be written to disk.
  if (!Buffer.isBuffer(req.body)) {
    throw new ApiError(415, 'Send the chunk as application/octet-stream');
  }

  const result = await ads.writeChunk({
    uploadId,
    chunkIndex,
    chunk: req.body,
    organizationId,
    userId,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, result, result.complete ? 'All chunks received' : 'Chunk stored'));
});

export const discardUploadSession = asyncHandler(async (req: Request, res: Response) => {
  const { uploadId } = UploadIdParamSchema.parse(req.params);
  const { organizationId, userId } = actor(req);
  await ads.discardUpload({ uploadId, organizationId, userId });
  return res.status(200).json(new ApiResponse(200, { uploadId }, 'Upload discarded'));
});

export const listAds = asyncHandler(async (req: Request, res: Response) => {
  const query = ListAdsQuerySchema.parse(req.query);
  const { organizationId } = actor(req);

  const where: Prisma.AdWhereInput = {
    organizationId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.kioskId ? { adKiosks: { some: { kioskId: query.kioskId } } } : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.ad.count({ where }),
    prisma.ad.findMany({
      where,
      include: adInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        items: rows.map(toAdResponse),
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
      'Ads retrieved',
    ),
  );
});

export const getAd = asyncHandler(async (req: Request, res: Response) => {
  const { id } = AdIdParamSchema.parse(req.params);
  const { organizationId } = actor(req);

  const ad = await prisma.ad.findFirst({ where: { id, organizationId }, include: adInclude });
  if (!ad) throw new ApiError(404, 'Ad not found');

  return res.status(200).json(new ApiResponse(200, toAdResponse(ad), 'Ad retrieved'));
});

export const createAd = asyncHandler(async (req: Request, res: Response) => {
  const body = CreateAdSchema.parse(req.body);
  const { organizationId, userId } = actor(req);

  const kioskIds = await resolveOwnedKiosks(organizationId, body.kioskIds);

  // Finalising the upload mints the stored filename and returns the byte size/MIME type
  // measured by the server — the Ad row is built only from those values.
  const video = await ads.completeUpload({ uploadId: body.uploadId, organizationId, userId });

  try {
    const ad = await prisma.$transaction(async (tx) => {
      const created = await tx.ad.create({
        data: {
          organizationId,
          title: body.title,
          description: body.description ? body.description : null,
          videoFilename: video.videoFilename,
          originalFilename: video.originalFilename,
          mimeType: video.mimeType,
          videoSizeBytes: video.videoSizeBytes,
          durationSeconds: null,
        },
      });

      if (kioskIds.length > 0) {
        await tx.adKiosk.createMany({
          data: kioskIds.map((kioskId) => ({ adId: created.id, kioskId })),
        });
      }

      return tx.ad.findUniqueOrThrow({ where: { id: created.id }, include: adInclude });
    });

    return res.status(201).json(new ApiResponse(201, toAdResponse(ad), 'Ad created'));
  } catch (error) {
    // The file is already in the served directory but no row references it; delete it so a
    // failed transaction cannot leak storage.
    await ads.deleteVideoFile(video.videoFilename).catch((cleanupError: unknown) => {
      console.error('[ads] orphaned video could not be removed', {
        videoFilename: video.videoFilename,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    });
    throw error;
  }
});

export const updateAd = asyncHandler(async (req: Request, res: Response) => {
  const { id } = AdIdParamSchema.parse(req.params);
  const body = UpdateAdSchema.parse(req.body);
  const { organizationId, userId } = actor(req);

  const existing = await prisma.ad.findFirst({
    where: { id, organizationId },
    select: { id: true, videoFilename: true },
  });
  if (!existing) throw new ApiError(404, 'Ad not found');

  // undefined = leave assignments untouched; [] = detach everything.
  const kioskIds = body.kioskIds === undefined
    ? undefined
    : await resolveOwnedKiosks(organizationId, body.kioskIds);

  // A replacement video is finalised before the row is touched: the stored filename and the
  // measured size/MIME type come from the upload session, never from the request body.
  const replacement = body.uploadId
    ? await ads.completeUpload({ uploadId: body.uploadId, organizationId, userId })
    : null;

  const data: Prisma.AdUpdateInput = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description;
  if (body.status !== undefined) data.status = body.status;
  if (replacement) {
    data.videoFilename = replacement.videoFilename;
    data.originalFilename = replacement.originalFilename;
    data.mimeType = replacement.mimeType;
    data.videoSizeBytes = replacement.videoSizeBytes;
  }

  const ad = await prisma
    .$transaction(async (tx) => {
      await tx.ad.update({ where: { id }, data });

      if (kioskIds !== undefined) {
        await tx.adKiosk.deleteMany({ where: { adId: id } });
        if (kioskIds.length > 0) {
          await tx.adKiosk.createMany({
            data: kioskIds.map((kioskId) => ({ adId: id, kioskId })),
          });
        }
      }

      return tx.ad.findUniqueOrThrow({ where: { id }, include: adInclude });
    })
    .catch(async (error: unknown) => {
      // The new bytes are stored but nothing references them; drop them so a failed update
      // cannot leak storage. The old file is still the one the row points at.
      if (replacement) {
        await ads.deleteVideoFile(replacement.videoFilename).catch(() => undefined);
      }
      throw error;
    });

  // Only after the row points at the new file may the old one be removed; the reverse order
  // would leave an ad referencing a file that no longer exists.
  if (replacement && existing.videoFilename !== replacement.videoFilename) {
    await ads.deleteVideoFile(existing.videoFilename).catch((error: unknown) => {
      console.error('[ads] replaced video could not be deleted', {
        adId: id,
        videoFilename: existing.videoFilename,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return res.status(200).json(new ApiResponse(200, toAdResponse(ad), 'Ad updated'));
});

export const deleteAd = asyncHandler(async (req: Request, res: Response) => {
  const { id } = AdIdParamSchema.parse(req.params);
  const { organizationId } = actor(req);

  const ad = await prisma.ad.findFirst({
    where: { id, organizationId },
    select: { id: true, videoFilename: true },
  });
  if (!ad) throw new ApiError(404, 'Ad not found');

  // Row first: a leftover file is recoverable, a row pointing at a deleted file is not.
  await prisma.ad.delete({ where: { id } });

  await ads.deleteVideoFile(ad.videoFilename).catch((error: unknown) => {
    console.error('[ads] stored video could not be deleted', {
      adId: ad.id,
      videoFilename: ad.videoFilename,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return res.status(200).json(new ApiResponse(200, { id: ad.id }, 'Ad deleted'));
});

/**
 * Stream a stored video to a member of the owning organization.
 *
 * Range requests are required for video playback (seeking and iOS-style partial fetches),
 * so this implements RFC 7233 single-range responses rather than res.sendFile's defaults.
 * The MIME type is the one validated at upload time, never a client-supplied header.
 */
/**
 * One multipart chunk for clients written against the mobile contract
 * (`POST /api/v1/ads/upload-chunk`).
 *
 * The session, offsets and validation are the same objects the `/uploads` + `PUT
 * .../chunks/:index` pair uses; only the transport differs, because mobile clients send a
 * single multipart request per chunk. The first request carries `filename`, `mimeType` and
 * `totalSize` and starts the session; later ones carry `uploadId` and `chunkIndex`. The
 * chunk is whichever file part arrives, so a client is free to name the field `file` or
 * `chunk`, and aliases (`originalFilename`, `chunk_index`, `total_size`) are accepted for
 * the snake_case clients.
 *
 * Completion is reported, not acted on: creating the ad still happens through
 * `POST /api/v1/ads` with this `uploadId`, so the row and its metadata are minted in one
 * place.
 */
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

type MultipartChunk = {
  fields: Map<string, string>;
  file: { filename: string; mimeType: string; data: Buffer } | null;
};

async function readMultipartChunk(req: Request): Promise<MultipartChunk> {
  const contentType = String(req.headers['content-type'] ?? '');
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new ApiError(415, 'Expected multipart/form-data');
  }

  // Reject an oversized body before buffering it. The declared length is the only size the
  // request states up front; a chunked upload is still bounded by the per-chunk write below.
  const declaredLength = Number(req.headers['content-length'] ?? 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > ads.maxChunkSizeBytes() + MULTIPART_OVERHEAD_BYTES
  ) {
    throw new ApiError(413, 'Chunk exceeds the configured chunk size');
  }

  // The platform parser, not a new dependency: the Express request is a Node stream and a
  // WHATWG Request accepts it with `duplex: 'half'`.
  const request = new globalThis.Request('http://upload.local/chunk', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ApiError(400, 'Malformed multipart body');
  }

  const fields = new Map<string, string>();
  let file: MultipartChunk['file'] = null;
  for (const [name, value] of form.entries()) {
    if (typeof value === 'string') {
      fields.set(name, value);
      continue;
    }
    // Only the first file part is the chunk; extra parts are ignored rather than guessed at.
    if (!file) {
      file = {
        filename: value.name || 'chunk',
        mimeType: value.type || '',
        data: Buffer.from(await value.arrayBuffer()),
      };
    }
  }

  return { fields, file };
}

export const uploadChunkMultipart = asyncHandler(async (req: Request, res: Response) => {
  const { organizationId, userId } = actor(req);
  const { fields, file } = await readMultipartChunk(req);
  if (!file || file.data.length === 0) {
    throw new ApiError(400, 'A chunk file part is required');
  }

  const chunkIndex = Number(fields.get('chunkIndex') ?? fields.get('chunk_index') ?? '0');
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    throw new ApiError(400, 'chunkIndex must be a non-negative integer');
  }

  let uploadId = (fields.get('uploadId') ?? fields.get('upload_id') ?? '').trim();
  let started: Awaited<ReturnType<typeof ads.initUpload>> | null = null;

  if (!uploadId) {
    const totalSizeRaw = fields.get('totalSize') ?? fields.get('total_size');
    // A single-part upload sends no totalSize; the chunk itself is the whole video.
    const totalSize = totalSizeRaw ? Number(totalSizeRaw) : file.data.length;
    started = await ads.initUpload({
      organizationId,
      userId,
      originalFilename:
        fields.get('filename') ?? fields.get('originalFilename') ?? file.filename,
      mimeType: fields.get('mimeType') ?? fields.get('mime_type') ?? file.mimeType,
      totalSize,
    });
    uploadId = started.uploadId;
  }

  const result = await ads.writeChunk({
    uploadId,
    chunkIndex,
    chunk: file.data,
    organizationId,
    userId,
  });

  res.status(200).json(
    new ApiResponse(
      200,
      {
        uploadId: result.uploadId,
        chunkIndex,
        chunkSize: result.chunkSize,
        totalChunks: result.totalChunks,
        totalSize: result.totalSize,
        receivedChunks: result.receivedChunks,
        complete: result.complete,
        maxVideoSizeBytes: started?.maxVideoSizeBytes ?? null,
        expiresInMs: started?.expiresInMs ?? null,
      },
      result.complete
        ? 'Upload complete; create the ad with this uploadId'
        : 'Chunk stored',
    ),
  );
});

/**
 * Member-facing playback by ad id.
 *
 * Resolves the row inside the caller's company, then delegates the transfer to
 * `serveAdVideo` -- the same implementation the kiosk sync feed uses, so both surfaces
 * answer Range requests and MIME the same way.
 */
export const streamAdVideo = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = AdIdParamSchema.parse(req.params);
    const companyOrgId = await resolveAdCompanyOrgId(req);

    const ad = await prisma.ad.findFirst({
      where: { id, organizationId: companyOrgId },
      select: { videoFilename: true, mimeType: true, originalFilename: true },
    });
    if (!ad) throw new ApiError(404, 'Ad not found');

    await serveAdVideo(req, res, next, ad);
  },
);

/**
 * Filename-addressed playback for clients written against the `/api/v1` contract.
 *
 * The stored name goes through the storage module's single choke point, so this route
 * cannot be used to reach another path, and the lookup is organization-scoped: an ad in
 * another company answers 404 exactly like a missing one. Range handling, headers and MIME
 * enforcement stay in `serveAdVideo`; this only resolves the id it needs.
 */
export const streamAdVideoByFilename = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const filename = ads.assertStoredFilename(String(req.params.filename ?? ''));
    const companyOrgId = await resolveAdCompanyOrgId(req);

    const ad = await prisma.ad.findFirst({
      where: { videoFilename: filename, organizationId: companyOrgId },
      select: { id: true },
    });
    if (!ad) throw new ApiError(404, 'Ad not found');

    req.params.id = ad.id;
    await streamAdVideo(req, res, next);
  },
);
