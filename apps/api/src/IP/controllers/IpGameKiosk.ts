/**
 * IpGameKiosk Controller
 *
 * Manages the connection between physical kiosks and IP games.
 *
 * Routes:
 *   POST   /api/ip/games/:ipGameId/kiosks            - Assign kiosks to a game  (COMPANY OWNER/ADMIN)
 *   DELETE /api/ip/games/:ipGameId/kiosks            - Remove kiosks from a game (COMPANY OWNER/ADMIN)
 *   GET    /api/ip/games/:ipGameId/kiosks            - List kiosks for a game    (COMPANY + IP_PARTY)
 *   GET    /api/ip/kiosks/:kioskId/games             - List games for a kiosk    (COMPANY)
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/db';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiResponse } from '../../utils/ApiResponse';
import { ApiError } from '../../utils/ApiError';
import '../../middlewares/auth';

const db = prisma as any;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const KioskIdsSchema = z.object({
  kioskIds: z
    .array(z.string().uuid('Each kioskId must be a valid UUID'))
    .min(1, 'At least one kioskId is required')
    .max(200, 'Cannot assign more than 200 kiosks in a single request'),
}).superRefine(({ kioskIds }, ctx) => {
  if (new Set(kioskIds).size !== kioskIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['kioskIds'],
      message: 'kioskIds must not contain duplicates',
    });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve and validate that the target is an ACTIVE IpGame owned by an IP_PARTY org. */
async function resolveIpGame(rawId: string | string[]) {
  if (Array.isArray(rawId)) throw new ApiError(400, 'Invalid ipGameId');
  const id: string = rawId;
  const game = await db.ipGame.findUnique({
    where: { id },
    select: {
      id: true,
      gameIdentifier: true,
      displayName: true,
      status: true,
      organizationId: true,
      organization: { select: { id: true, name: true, type: true } },
    },
  });

  if (!game || game.organization.type !== 'IP_PARTY') {
    throw new ApiError(404, 'IP Game not found');
  }

  return game;
}

// ---------------------------------------------------------------------------
// POST /api/ip/games/:ipGameId/kiosks
// Assign (connect) one or more kiosks to an IP game.
// Company OWNER / ADMIN only.
// ---------------------------------------------------------------------------

export const assignKiosksToIpGame = asyncHandler(async (req: Request, res: Response) => {
  const orgType = req.membership?.type;
  const role    = req.membership?.role;

  if (orgType !== 'COMPANY') {
    throw new ApiError(403, 'Only the Company organization can assign kiosks to IP games');
  }
  if (!role || !['OWNER', 'ADMIN'].includes(role)) {
    throw new ApiError(403, 'Only Company OWNER or ADMIN can assign kiosks to IP games');
  }

  const { ipGameId } = req.params;
  if (!ipGameId) throw new ApiError(400, 'ipGameId is required');

  const { kioskIds } = KioskIdsSchema.parse(req.body);

  const game = await resolveIpGame(ipGameId);

  // Verify every requested kiosk actually exists in our fleet.
  const foundKiosks = await db.kiosk.findMany({
    where: {
      id: { in: kioskIds },
      currentOrgId: req.membership!.organizationId,
    },
    select: { id: true, machineCode: true, status: true, currentOrgId: true },
  });

  if (foundKiosks.length !== kioskIds.length) {
    const foundIds = new Set(foundKiosks.map((k: any) => k.id));
    const missing  = kioskIds.filter((id) => !foundIds.has(id));
    throw new ApiError(404, `The following kiosk IDs were not found: ${missing.join(', ')}`);
  }

  // Upsert: skip pairs that already exist, insert new ones.
  const data = kioskIds.map((kioskId) => ({ ipGameId, kioskId }));

  // createMany with skipDuplicates is the idempotent bulk insert.
  const result = await db.ipGameKiosk.createMany({
    data,
    skipDuplicates: true,
  });

  res.status(200).json(
    new ApiResponse(
      200,
      {
        game: {
          id:             game.id,
          gameIdentifier: game.gameIdentifier,
          displayName:    game.displayName,
          organization:   game.organization,
        },
        requested: kioskIds.length,
        newlyAssigned: result.count,
        alreadyAssigned: kioskIds.length - result.count,
      },
      result.count === 0
        ? 'All requested kiosks were already connected to this game'
        : `${result.count} kiosk(s) connected to IP game successfully`,
    ),
  );
});

// ---------------------------------------------------------------------------
// DELETE /api/ip/games/:ipGameId/kiosks
// Remove (disconnect) one or more kiosks from an IP game.
// Company OWNER / ADMIN only.
// ---------------------------------------------------------------------------

export const removeKiosksFromIpGame = asyncHandler(async (req: Request, res: Response) => {
  const orgType = req.membership?.type;
  const role    = req.membership?.role;

  if (orgType !== 'COMPANY') {
    throw new ApiError(403, 'Only the Company organization can remove kiosks from IP games');
  }
  if (!role || !['OWNER', 'ADMIN'].includes(role)) {
    throw new ApiError(403, 'Only Company OWNER or ADMIN can remove kiosks from IP games');
  }

  const { ipGameId } = req.params;
  if (!ipGameId) throw new ApiError(400, 'ipGameId is required');

  const { kioskIds } = KioskIdsSchema.parse(req.body);

  // Confirm the game exists (no need to check org type strictly here — just 404 gracefully).
  const game = await db.ipGame.findUnique({
    where: { id: ipGameId },
    select: { id: true, gameIdentifier: true, displayName: true },
  });
  if (!game) throw new ApiError(404, 'IP Game not found');

  const deleted = await db.ipGameKiosk.deleteMany({
    where: {
      ipGameId,
      kioskId: { in: kioskIds },
    },
  });

  res.status(200).json(
    new ApiResponse(
      200,
      {
        game: { id: game.id, gameIdentifier: game.gameIdentifier, displayName: game.displayName },
        removed: deleted.count,
      },
      deleted.count === 0
        ? 'None of the specified kiosks were connected to this game'
        : `${deleted.count} kiosk(s) disconnected from IP game successfully`,
    ),
  );
});

// ---------------------------------------------------------------------------
// GET /api/ip/games/:ipGameId/kiosks
// List all kiosks connected to an IP game.
// Company (any role) or IP_PARTY member of the owning org.
// ---------------------------------------------------------------------------

export const getKiosksForIpGame = asyncHandler(async (req: Request, res: Response) => {
  const orgType = req.membership?.type;
  const orgId   = req.membership?.organizationId;

  if (!orgType || !['COMPANY', 'IP_PARTY'].includes(orgType)) {
    throw new ApiError(403, 'Unauthorized to view IP game kiosks');
  }

  const { ipGameId } = req.params;
  if (!ipGameId) throw new ApiError(400, 'ipGameId is required');

  const game = await resolveIpGame(ipGameId);

  // IP_PARTY members may only view their own game's kiosks.
  if (orgType === 'IP_PARTY' && game.organizationId !== orgId) {
    throw new ApiError(403, 'You can only view kiosks for your own IP games');
  }

  const links = await db.ipGameKiosk.findMany({
    where: { ipGameId },
    select: {
      id:         true,
      assignedAt: true,
      kiosk: {
        select: {
          id:              true,
          machineCode:     true,
          model:           true,
          status:          true,
          location:        true,
          externalDeviceId: true,
          currentOrg: {
            select: { id: true, name: true, type: true },
          },
        },
      },
    },
    orderBy: { assignedAt: 'desc' },
  });

  const kiosks = links.map((link: any) => ({
    connectionId: link.id,
    assignedAt:   link.assignedAt,
    ...link.kiosk,
  }));

  res.status(200).json(
    new ApiResponse(
      200,
      {
        game: {
          id:             game.id,
          gameIdentifier: game.gameIdentifier,
          displayName:    game.displayName,
          organization:   game.organization,
        },
        kiosks,
        total: kiosks.length,
      },
      kiosks.length === 0
        ? 'No kiosks are currently connected to this IP game'
        : 'Kiosks for IP game retrieved successfully',
    ),
  );
});

// ---------------------------------------------------------------------------
// GET /api/ip/kiosks/:kioskId/games
// List all IP games a kiosk is connected to.
// Company only.
// ---------------------------------------------------------------------------

export const getIpGamesForKiosk = asyncHandler(async (req: Request, res: Response) => {
  const orgType = req.membership?.type;

  if (orgType !== 'COMPANY') {
    throw new ApiError(403, 'Only the Company organization can view a kiosk\'s IP game connections');
  }

  const { kioskId } = req.params;
  if (!kioskId) throw new ApiError(400, 'kioskId is required');

  // Verify kiosk exists.
  const kiosk = await db.kiosk.findUnique({
    where: { id: kioskId },
    select: { id: true, machineCode: true, model: true, status: true, location: true },
  });
  if (!kiosk) throw new ApiError(404, 'Kiosk not found');

  const links = await db.ipGameKiosk.findMany({
    where: { kioskId },
    select: {
      id:         true,
      assignedAt: true,
      ipGame: {
        select: {
          id:             true,
          gameIdentifier: true,
          displayName:    true,
          coverImageUrl:  true,
          status:         true,
          organization: {
            select: { id: true, name: true },
          },
        },
      },
    },
    orderBy: { assignedAt: 'desc' },
  });

  const games = links.map((link: any) => ({
    connectionId: link.id,
    assignedAt:   link.assignedAt,
    ...link.ipGame,
  }));

  res.status(200).json(
    new ApiResponse(
      200,
      {
        kiosk,
        games,
        total: games.length,
      },
      games.length === 0
        ? 'This kiosk is not connected to any IP games'
        : 'IP games for kiosk retrieved successfully',
    ),
  );
});
