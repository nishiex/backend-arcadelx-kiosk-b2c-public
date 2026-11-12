import type { Request, Response, NextFunction } from 'express';
import { createReadStream } from 'node:fs';
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
    kioskIds: ad.adKiosks.map((link) => link.kioskId),
    createdAt: ad.createdAt,
    updatedAt: ad.updatedAt,
  };
}

/**
 * A kiosk can only carry an ad while this organization currently owns it. Ownership is
 * `Kiosk.currentOrgId`; the join table deliberately has no tenant column, so this check is
 * the boundary that keeps one tenant's ad off another tenant's hardware.
 */
async function resolveOwnedKiosks(organizationId: string, kioskIds: string[]): Promise<string[]> {
  const unique = [...new Set(kioskIds)];
  if (unique.length === 0) return [];

  const kiosks = await prisma.kiosk.findMany({
    where: { id: { in: unique } },
    select: { id: true, currentOrgId: true, status: true },
  });

  const owned = new Set(
    kiosks.filter((kiosk) => kiosk.currentOrgId === organizationId).map((kiosk) => kiosk.id),
  );
  const rejected = unique.filter((id) => !owned.has(id));
  if (rejected.length > 0) {
    throw new ApiError(400, `Kiosks are not owned by this organization: ${rejected.join(', ')}`);
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
  const { organizationId } = actor(req);

  const existing = await prisma.ad.findFirst({
    where: { id, organizationId },
    select: { id: true },
  });
  if (!existing) throw new ApiError(404, 'Ad not found');

  // undefined = leave assignments untouched; [] = detach everything.
  const kioskIds = body.kioskIds === undefined
    ? undefined
    : await resolveOwnedKiosks(organizationId, body.kioskIds);

  const data: Prisma.AdUpdateInput = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description;
  if (body.status !== undefined) data.status = body.status;

  const ad = await prisma.$transaction(async (tx) => {
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
  });

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
export const streamAdVideo = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const { id } = AdIdParamSchema.parse(req.params);
    const { organizationId } = actor(req);

    const ad = await prisma.ad.findFirst({
      where: { id, organizationId },
      select: { videoFilename: true, mimeType: true, originalFilename: true },
    });
    if (!ad) throw new ApiError(404, 'Ad not found');

    if (!(ads.ALLOWED_VIDEO_TYPES as readonly string[]).includes(ad.mimeType)) {
      throw new ApiError(415, 'Stored video type is not supported');
    }

    const { filePath, size } = await ads.statVideo(ad.videoFilename);

    const safeName = ad.originalFilename.replace(/[^\w.\-]+/g, '_') || 'ad.mp4';
    res.setHeader('Content-Type', ad.mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

    const range = req.headers.range;
    if (!range) {
      res.status(200);
      res.setHeader('Content-Length', String(size));
      const stream = createReadStream(filePath);
      stream.on('error', (error) => {
        if (res.headersSent) res.destroy();
        else next(error);
      });
      stream.pipe(res);
      return;
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match || (match[1] === '' && match[2] === '')) {
      res.setHeader('Content-Range', `bytes */${size}`);
      throw new ApiError(416, 'Invalid range header');
    }

    let start: number;
    let end: number;

    if (match[1] === '') {
      // Suffix range: the last N bytes.
      const suffix = Number(match[2]);
      if (!Number.isInteger(suffix) || suffix <= 0) {
        res.setHeader('Content-Range', `bytes */${size}`);
        throw new ApiError(416, 'Invalid range header');
      }
      start = Math.max(size - suffix, 0);
      end = size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
    }

    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= size) {
      res.setHeader('Content-Range', `bytes */${size}`);
      throw new ApiError(416, 'Requested range not satisfiable');
    }

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));

    const stream = createReadStream(filePath, { start, end });
    stream.on('error', (error) => {
      if (res.headersSent) res.destroy();
      else next(error);
    });
    stream.pipe(res);
  },
);
