/*Register a IP Game for a specific IP , 
  Fetch available observed game IDs for a IP Party , 
  Fetch all games for a IP Party  -> Company
  Fetch My games -> IP
*/

import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/db';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiResponse } from '../../utils/ApiResponse';
import { ApiError } from '../../utils/ApiError';
import '../../middlewares/auth';

const db = prisma as any;

export const normalizeGameIdentifier = (raw: string): string => {
  return raw.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, ''); 
};

export const slugToDisplayName = (slug: string): string => {
  return slug.split('-').filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
};

export const CreateIpGameSchema = z.object({
  displayName: z.string({ message: 'Display name is required' }).trim().min(2, 'Display name must be at least 2 characters').max(100, 'Display name cannot exceed 100 characters'),
  gameIdentifier: z.string({ message: 'Game ID is required' }).trim().min(2, 'Game ID must be at least 2 characters').max(100, 'Game ID cannot exceed 100 characters'),
  coverImageUrl: z.string().trim().url('Cover image must be a valid URL').optional().or(z.literal('')).nullable(),
  launchDate: z.string().optional().or(z.literal('')).nullable(),
  ipOrgId: z.string().optional(),
});

/**
 * COMPANY DASHBOARD:
 * Fetch available game IDs observed in incoming transactions for a selected IP Party's sourceKey,
 * excluding game IDs that are already registered in IpGame.
 * GET /api/ip/games/:ipOrgId/available-identifiers
 */
export const getAvailableObservedGameIds = asyncHandler(async (req: Request, res: Response) => {
  const currentOrgType = req.membership?.type;
  if (currentOrgType !== 'COMPANY') throw new ApiError(403, 'Only the Company organization can view available observed game IDs');

  const { ipOrgId } = req.params;
  const targetOrgId = ipOrgId || req.params.organizationId;

  if (!targetOrgId || typeof targetOrgId !== 'string') throw new ApiError(400, 'Invalid IP organization ID');

  // 1. Verify target organization exists and is an IP_PARTY
  const ipOrg = await prisma.organization.findUnique({
    where: { id: targetOrgId },
    select: { id: true, name: true, type: true },
  });

  if (!ipOrg || (ipOrg.type as any) !== 'IP_PARTY') throw new ApiError(404, 'IP Party organization not found');

  // 2. Lookup IP Profile to retrieve this IP Party's sourceKey
  let ipProfile: any = null;
    ipProfile = await (db.ipProfile as any).findUnique({
      where: { organizationId: targetOrgId },
      select: { sourceKey: true },
    });

  if (!ipProfile || !ipProfile.sourceKey) throw new ApiError(404, 'IP Profile or source key not found for this IP Party');

  const sourceKey = ipProfile.sourceKey;

  // 3. Query observed game IDs from transactions for this sourceKey
  let observedGameRecords: { gameId: string; transactionCount: number; lastObservedAt: Date }[] = [];
    const rows = await (db.transaction as any).findMany({
      where: { source: sourceKey },
      select: { gameId: true, occurredAt: true },
    });

    const map = new Map<string, { count: number; lastObserved: Date }>();
    for (const r of rows) {
      if (!r.gameId) continue;
      const existing = map.get(r.gameId);
      if (!existing) {
        map.set(r.gameId, { count: 1, lastObserved: r.occurredAt });
      } else {
        existing.count++;
        if (r.occurredAt > existing.lastObserved) {
          existing.lastObserved = r.occurredAt;
        }
      }
    }

    observedGameRecords = Array.from(map.entries()).map(([gameId, data]) => ({
      gameId,
      transactionCount: data.count,
      lastObservedAt: data.lastObserved,
    }));
  

  // 4. Query registered game identifiers in IpGame
  let registeredIdentifiers = new Set<string>();
    const existingGames = await (db.ipGame as any).findMany({
      select: { gameIdentifier: true },
    });
    registeredIdentifiers = new Set(
      existingGames.map((g: any) => g.gameIdentifier.toLowerCase())
    );

  // 5. Exclude IDs already registered in IpGame (both raw and slugified)
  // The game ID's which are comming in the transaction are sluggified , to match the registerd version 
  // the registered version sluggifies it 
  const availableGameIds = observedGameRecords.filter((record) => {
      const normalized = normalizeGameIdentifier(record.gameId);
      return !registeredIdentifiers.has(record.gameId.toLowerCase()) && !registeredIdentifiers.has(normalized);
    }).map((record) => ({
      gameId: record.gameId,
      normalizedGameIdentifier: normalizeGameIdentifier(record.gameId),
      suggestedDisplayName: slugToDisplayName(normalizeGameIdentifier(record.gameId)),
      transactionCount: record.transactionCount,
      lastObservedAt: record.lastObservedAt,
    }));

  res.status(200).json(
    new ApiResponse(
      200,
      {
        organization: {
          id: ipOrg.id,
          name: ipOrg.name,
          sourceKey,
        },
        availableGameIds,
        total: availableGameIds.length,
      },
      availableGameIds.length === 0
        ? 'No unregistered observed game IDs found for this IP Party'
        : 'Available observed game IDs fetched successfully'
    )
  );
});

/**
 * COMPANY DASHBOARD:
 * Register a game for a specific IP Party.
 * 
 * POST /api/ip/games/:ipOrgId
 */
export const createIpGame = asyncHandler(async (req: Request, res: Response) => {
  const currentOrgType = req.membership?.type;
  if (currentOrgType !== 'COMPANY') throw new ApiError(403, 'Only the Company organization is authorized to register IP games');

  const targetOrgId =req.params.ipOrgId ;

  if (!targetOrgId || typeof targetOrgId !== 'string') throw new ApiError(400, 'Invalid or missing IP organization ID');

  // 1. Verify target organization exists and has type IP_PARTY
  const ipOrg = await prisma.organization.findUnique({
    where: { id: targetOrgId },
    select: { id: true, name: true, type: true },
  });

  if (!ipOrg || (ipOrg.type as any) !== 'IP_PARTY') throw new ApiError(404, 'IP Party organization not found');

  // 2. Validate request body
  const validatedData = CreateIpGameSchema.parse(req.body);

  // 3. Normalize gameIdentifier into slug
  // the game ID written is written normally , then converted to hyphenated slug to keep in DB
  const normalizedIdentifier = normalizeGameIdentifier(validatedData.gameIdentifier);
  
  if (!normalizedIdentifier || normalizedIdentifier.length < 2) throw new ApiError(400, 'Game ID must contain at least 2 valid alphanumeric characters');

  // 4. Check for existing game with this identifier (global uniqueness)
  let existingGame: any = null;

    existingGame = await (db.ipGame as any).findUnique({
      where: { gameIdentifier: normalizedIdentifier },
    });
  

  if (existingGame) {throw new ApiError(409,`Game with identifier '${normalizedIdentifier}' is already registered`);}

  // 5. Parse launch date if provided
  const launchDateTime = validatedData.launchDate ? new Date(validatedData.launchDate) : null;

  if (launchDateTime && isNaN(launchDateTime.getTime())) throw new ApiError(400, 'Invalid launchDate timestamp');

  const cleanCoverImageUrl = validatedData.coverImageUrl && validatedData.coverImageUrl.trim() !== '' ? validatedData.coverImageUrl.trim() : null;

  // 6. Create game record linked to the selected IP Party
  let createdGame: any;
  try {
    createdGame = await (db.ipGame as any).create({
      data: {
        organizationId: targetOrgId,
        gameIdentifier: normalizedIdentifier,
        displayName: validatedData.displayName.trim(),
        coverImageUrl: cleanCoverImageUrl,
        launchDate: launchDateTime,
        status: 'ACTIVE',
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002' || err?.message?.includes('Unique constraint failed')) {
      throw new ApiError(409,`Game with identifier '${normalizedIdentifier}' is already registered`);
    }

  }

  res.status(201).json(new ApiResponse(201,
      {
        game: {
          id: createdGame.id,
          organizationId: createdGame.organizationId,
          gameIdentifier: createdGame.gameIdentifier,
          displayName: createdGame.displayName,
          coverImageUrl: createdGame.coverImageUrl,
          launchDate: createdGame.launchDate,
          status: createdGame.status,
          createdAt: createdGame.createdAt,
        },
      },
      'IP Game registered successfully'
    )
  );
});

/**
 * IP DASHBOARD:
 * Read-only endpoint for an authenticated IP Party member to fetch their organization's games.
 * GET /api/ip/my-games
 * Allowed: IP_PARTY members (read-only)
 */
export const getMyGames = asyncHandler(async (req: Request, res: Response) => {
  const currentOrgType = req.membership?.type;
  const currentOrgId = req.membership?.organizationId;

  if (currentOrgType !== 'IP_PARTY') {
    throw new ApiError(403, 'Only IP Party members can access My Games');
  }

  if (!currentOrgId) {
    throw new ApiError(403, 'No active organization found in session');
  }

  let games: any[] = [];
    games = await (db.ipGame as any).findMany({
      where: {
        organizationId: currentOrgId,
      },
      select: {
        id: true,
        organizationId: true,
        gameIdentifier: true,
        displayName: true,
        coverImageUrl: true,
        launchDate: true,
        status: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

  res.status(200).json(new ApiResponse(200,
      {
        games,
        total: games.length,
      },
      games.length === 0 ? 'No games registered yet' : 'Games retrieved successfully'
    )
  );
});

/**
 * COMPANY DASHBOARD:
 * View all games registered for a specific IP Party.
 * GET /api/ip/games/:ipOrgId
 * Allowed: Company OWNER, ADMIN, MANAGER
 */
export const getIpPartyGames = asyncHandler(async (req: Request, res: Response) => {
  const currentOrgType = req.membership?.type;
  if (currentOrgType !== 'COMPANY') throw new ApiError(403, 'Only the Company organization can view IP Party games');

  const { ipOrgId } = req.params;
  const targetOrgId = ipOrgId || req.params.organizationId;

  if (!targetOrgId || typeof targetOrgId !== 'string') throw new ApiError(400, 'Invalid IP organization ID');

  // Verify target organization exists and is an IP_PARTY
  const ipOrg = await prisma.organization.findUnique({
    where: { id: targetOrgId },
    select: { id: true, name: true, type: true },
  });

  if (!ipOrg || (ipOrg.type as any) !== 'IP_PARTY') throw new ApiError(404, 'IP Party organization not found');

  let games: any[] = [];{
    games = await (db.ipGame as any).findMany({
      where: {
        organizationId: targetOrgId,
      },
      select: {
        id: true,
        organizationId: true,
        gameIdentifier: true,
        displayName: true,
        coverImageUrl: true,
        launchDate: true,
        status: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
 

  res.status(200).json(new ApiResponse(200,
      {
        organization: {
          id: ipOrg.id,
          name: ipOrg.name,
        },
        games,
        total: games.length,
      },
      'IP Party games retrieved successfully'
    )
  );
}});

