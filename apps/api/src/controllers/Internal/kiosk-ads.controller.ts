/**
 * Kiosk-facing ad delivery.
 *
 * Assigning an ad in the ArcadeLx console writes an `AdKiosk` row; nothing is pushed to
 * the hardware. This feed is the other half of that feature: a kiosk (or the broker in
 * front of it) asks what it should play, downloads the bytes, and deletes whatever the
 * manifest no longer lists on its next poll.
 *
 * Both routes sit on `/api/internal` and therefore carry the same `X-Internal-Api-Key`
 * guard as the pairing endpoints -- a machine has no user session, and the secret lives on
 * the kiosk broker, never in a browser. `kioskId` accepts the machine code printed on the
 * cabinet (`ADLX-2026-A010`) or Mothership's hardware UUID, because both are what the
 * device knows about itself.
 *
 * The file route re-checks the assignment on every request instead of trusting a one-off
 * manifest: unassigning an ad (or deactivating it) takes effect on the very next download,
 * even for a kiosk that already holds a copy. A retired cabinet gets an empty manifest and
 * 404s, so decommissioned hardware cannot keep pulling library content.
 */
import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { prisma } from '../../utils/db';
import { ApiError } from '../../utils/ApiError';
import { ApiResponse } from '../../utils/ApiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import * as ads from '../../services/ads.service';
import { serveAdVideo } from '../Ads/ad-video';

/** Path the manifest hands out; kept relative so the kiosk can join it to its base URL. */
const DOWNLOAD_PATH = '/api/internal/ads/files';

const manifestAdSelect = {
  id: true,
  title: true,
  description: true,
  originalFilename: true,
  videoFilename: true,
  mimeType: true,
  videoSizeBytes: true,
  durationSeconds: true,
  updatedAt: true,
} as const;

/**
 * Resolve the cabinet by machine code first, then by Mothership's hardware UUID.
 *
 * `machineCode` is the human-facing identifier operators quote in tickets, while
 * `externalDeviceId` is what the device itself was paired with; either may arrive here.
 */
async function findSyncKiosk(reference: string) {
  return prisma.kiosk.findFirst({
    where: { OR: [{ machineCode: reference }, { externalDeviceId: reference }] },
    select: {
      id: true,
      machineCode: true,
      status: true,
      externalDeviceId: true,
      adKiosks: {
        where: { ad: { status: 'ACTIVE' } },
        orderBy: { assignedAt: 'asc' },
        select: { assignedAt: true, ad: { select: manifestAdSelect } },
      },
    },
  });
}

/**
 * Version tag for the manifest.
 *
 * Derived from the kiosk and the ids/timestamps of the ads it currently carries, so the
 * value changes exactly when the playlist changes. Kiosks poll with `If-None-Match` and get
 * a cheap 304 while the assignment is unchanged, instead of re-downloading metadata and
 * recomputing their local playlist every cycle.
 */
function manifestVersion(kioskId: string, adsInManifest: { id: string; updatedAt: Date }[]): string {
  const digest = crypto
    .createHash('sha256')
    .update(
      [kioskId, ...adsInManifest.map((ad) => `${ad.id}:${ad.updatedAt.toISOString()}`)].join('|'),
    )
    .digest('hex');
  return `W/"${digest.slice(0, 32)}"`;
}

/**
 * `GET /api/internal/kiosks/:machineCode/ads`
 *
 * The playlist a cabinet should be running: every ACTIVE ad currently assigned to it.
 * `downloadPath` is per-ad and already carries the kiosk reference, so a client can fetch
 * each file without keeping its own notion of identity. Retired cabinets answer 200 with
 * an empty list (not 404): the device is known, it simply must not play anything.
 */
export const getKioskAdManifest = asyncHandler(async (req: Request, res: Response) => {
  const reference = String(req.params.machineCode ?? '').trim();
  if (!reference) throw new ApiError(400, 'Machine code is required');

  const kiosk = await findSyncKiosk(reference);
  if (!kiosk) throw new ApiError(404, `Kiosk ${reference} does not exist in the business system`);

  const retired = kiosk.status === 'RETIRED';
  const assignments = retired ? [] : kiosk.adKiosks;

  const version = manifestVersion(
    kiosk.id,
    assignments.map((row) => row.ad),
  );
  res.setHeader('ETag', version);
  // A manifest is cheap to re-derive but must never be replayed from a shared cache:
  // the answer differs per kiosk and changes the moment an assignment is edited.
  res.setHeader('Cache-Control', 'no-cache');

  const ifNoneMatch = String(req.headers['if-none-match'] ?? '');
  if (ifNoneMatch.split(',').map((tag) => tag.trim()).includes(version)) {
    res.status(304).end();
    return;
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        kiosk: {
          id: kiosk.id,
          machineCode: kiosk.machineCode,
          status: kiosk.status,
          externalDeviceId: kiosk.externalDeviceId,
        },
        version,
        generatedAt: new Date().toISOString(),
        ads: assignments.map(({ ad, assignedAt }) => ({
          id: ad.id,
          title: ad.title,
          description: ad.description,
          originalFilename: ad.originalFilename,
          videoFilename: ad.videoFilename,
          mimeType: ad.mimeType,
          sizeBytes: ad.videoSizeBytes,
          durationSeconds: ad.durationSeconds,
          updatedAt: ad.updatedAt,
          assignedAt,
          downloadPath: `${DOWNLOAD_PATH}/${encodeURIComponent(ad.videoFilename)}?kioskId=${encodeURIComponent(kiosk.machineCode)}`,
        })),
      },
      retired ? 'Kiosk is retired; no ads are served' : 'Ad manifest retrieved',
    ),
  );
});

/**
 * `GET /api/internal/ads/files/:filename?kioskId=<machine code or hardware UUID>`
 *
 * The bytes behind a manifest entry. Assignment is re-checked here rather than inferred
 * from the filename, so the endpoint cannot be used to walk the library: an ad that is not
 * assigned to this cabinet (or is no longer ACTIVE) answers exactly like a missing one.
 * Range support comes from `serveAdVideo`, which the member-facing routes share.
 */
export const streamKioskAdVideo = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    const filename = ads.assertStoredFilename(String(req.params.filename ?? ''));
    const reference = String(req.query.kioskId ?? '').trim();
    if (!reference) throw new ApiError(400, 'kioskId is required');

    const kiosk = await prisma.kiosk.findFirst({
      where: { OR: [{ machineCode: reference }, { externalDeviceId: reference }] },
      select: { id: true, status: true },
    });
    if (!kiosk) throw new ApiError(404, `Kiosk ${reference} does not exist in the business system`);
    if (kiosk.status === 'RETIRED') throw new ApiError(404, 'Kiosk is retired');

    const ad = await prisma.ad.findFirst({
      where: {
        videoFilename: filename,
        status: 'ACTIVE',
        adKiosks: { some: { kioskId: kiosk.id } },
      },
      select: { videoFilename: true, mimeType: true, originalFilename: true },
    });
    if (!ad) throw new ApiError(404, 'Ad is not assigned to this kiosk');

    await serveAdVideo(req, res, next, ad);
  },
);
