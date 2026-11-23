import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../utils/db';
import { ApiError } from '../../utils/ApiError';
import { ApiResponse } from '../../utils/ApiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  DeviceGameParamsSchema,
  DeviceParamsSchema,
  ResetDevicePricesResultSchema,
  ResetAllDevicePricesResultSchema,
  SetDeviceGamePriceSchema,
  SetDeviceGamePriceResultSchema,
} from '@shared-types/validationSchemas/Devices/device.validation';
import {  getDevicePrices,
  getLauncherServedPrices,
  listDevices,
  resetDevicePrices,
  resetAllDevicePrices,
  setDeviceGamePrice,
} from '../../services/Mothership/devices.service';
import { networkOrgIds } from '../../services/network-scope';
import { assertDeviceNotRetired, BUSINESS_TIMEZONE, businessDate, cancelScheduledDevicePrice, eodRunForDate, getEodPricingTime, markGameScheduledUpdatesSuperseded, markScheduledUpdatesSuperseded, nextEod, pricingStatus, scheduleEodDevicePrice } from '../../services/Mothership/eod-pricing.service';

/**
 * Device fleet and per-device game pricing.
 *
 * Reads are open to any signed-in member of the organization, because they describe
 * hardware the fleet operator already owns. Price writes are reserved for Company
 * OWNER/ADMIN. The body's `scope` decides the reach: `DEVICE` (default) writes a
 * device-only override and is only successful when readback confirms the selected device
 * changed without changing catalog or fleet prices; `GAME_CATALOG`, only when the caller
 * asks for it explicitly, updates the game's catalog price and is confirmed against the
 * catalog readback. Neither scope substitutes for the other.
 *
 * Params and body are validated here before anything is forwarded, so a malformed
 * request fails with a specific 400 instead of an opaque upstream error.
 */

export const getDevices = asyncHandler(async (_req: Request, res: Response) => {
  const req = _req;
  const { devices: upstreamDevices, lastUpdated } = await listDevices();
  const visible = await visibleDevices(req, upstreamDevices);
  // Each kiosk reports the ad files it holds, but no upstream route serves those bytes.
  // Resolve reported names against the Company ad library (including for kiosks assigned to
  // child Distributors and Partners).
  let companyOrgId = req.membership!.organizationId;
  if (req.membership!.type !== 'COMPANY') {
    const org = await prisma.organization.findUnique({
      where: { id: req.membership!.organizationId },
      select: { parentOrgId: true, parentOrg: { select: { id: true, type: true, parentOrgId: true } } },
    });
    if (org?.parentOrg?.type === 'COMPANY') {
      companyOrgId = org.parentOrg.id;
    } else if (org?.parentOrg?.parentOrgId) {
      companyOrgId = org.parentOrg.parentOrgId;
    } else {
      const company = await prisma.organization.findFirst({
        where: { type: 'COMPANY' },
        select: { id: true },
      });
      if (company) companyOrgId = company.id;
    }
  }
  const devices = visible;
  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { devices, lastUpdated, total: devices.length },
        'Devices fetched successfully',
      ),
    );
});

export const getPricesForDevice = asyncHandler(async (req: Request, res: Response) => {
  const parsed = DeviceParamsSchema.safeParse(req.params);
  if (!parsed.success) throw new ApiError(400, 'Invalid device id', parsed.error.issues);

  await assertDeviceVisible(req, parsed.data.deviceId);
  const games = await getDevicePrices(parsed.data.deviceId);
  // What the kiosk itself serves. Stored overrides are Mothership's intent; the launcher
  // feed is what the machine charges, so a mismatch is shown next to the configured price
  // instead of hiding behind it.
  //
  // Only trusted when the feed echoes the requested device: for devices the launcher does not
  // treat as containers it answers with the global default and `device_id: null`, and calling
  // that "what this kiosk serves" would show a false mismatch on every such machine.
  const served = await getLauncherServedPrices(parsed.data.deviceId).catch(() => null);
  // The global feed (`launcher/games` with no kiosk_id — the trailing `?` form is the same
  // request) is the fleet default. Read it alongside the kiosk view so the operator can see
  // which number is the default and which is this machine's own.
  const fleet = await getLauncherServedPrices().catch(() => null);
  const fleetGames = fleet?.games ?? [];
  const servesThisDevice =
    Boolean(served?.deviceId) &&
    served!.deviceId.toLowerCase() === parsed.data.deviceId.toLowerCase();
  const servedGames = servesThisDevice ? served!.games : [];
  const gamesWithServed = games.map((game) => {
    const match =
      servedGames.find((entry) => entry.gameId === game.gameId) ??
      servedGames.find((entry) => entry.displayName === game.displayName);
    if (!match) return game;
    const same = (a: number, b: number) => Math.abs(a - b) < 0.01;
    const fleetMatch =
      fleetGames.find((entry) => entry.gameId === game.gameId) ??
      fleetGames.find((entry) => entry.displayName === game.displayName);
    return {
      ...game,
      servedPrice: match.price,
      servedReplayPrice: match.replayPrice,
      servesConfiguredPrice:
        same(match.price, game.effectivePrice) && same(match.replayPrice, game.effectiveReplayPrice),
      ...(fleetMatch
        ? { fleetPrice: fleetMatch.price, fleetReplayPrice: fleetMatch.replayPrice }
        : {}),
    };
  });
  const eod = await Promise.all(games.map(async game => ({ gameId: game.gameId, update: await pricingStatus(parsed.data.deviceId, game.gameId) })));
  const kiosk = await prisma.kiosk.findFirst({
    where: { OR: [{ externalDeviceId: parsed.data.deviceId }, { machineCode: parsed.data.deviceId }] },
    select: { status: true },
  });
  res
    .status(200)
    .json(new ApiResponse(200, { deviceId: parsed.data.deviceId, games: gamesWithServed, kioskStatus: kiosk?.status ?? null, launcher: servesThisDevice ? { deviceId: served!.deviceId } : null, fleet: fleet ? { games: fleet.games.length } : null, eod: Object.fromEntries(eod.map(item => [item.gameId, item.update])), eodMeta: { timezone: BUSINESS_TIMEZONE, runTime: getEodPricingTime(), nextExecutionAt: nextEod() } }, 'Prices fetched successfully'));
});

export const cancelScheduledDeviceGamePrice = asyncHandler(async (req: Request, res: Response) => {
  const params = DeviceGameParamsSchema.safeParse(req.params);
  if (!params.success) throw new ApiError(400, 'Invalid device or game id', params.error.issues);
  assertCompanyAdmin(req);
  await assertDeviceVisible(req, params.data.deviceId);
  const cancelled = await cancelScheduledDevicePrice(params.data.deviceId, params.data.gameId);
  res.status(200).json(new ApiResponse(200, { deviceId: params.data.deviceId, gameId: params.data.gameId, cancelled }, cancelled ? 'Scheduled device price update cancelled' : 'No actionable scheduled update found'));
});

export const resetPricesForDevice = asyncHandler(async (req: Request, res: Response) => {
  const params = DeviceParamsSchema.safeParse(req.params);
  if (!params.success) throw new ApiError(400, 'Invalid device id', params.error.issues);
  assertCompanyAdmin(req);
  await assertDeviceVisible(req, params.data.deviceId);

  const result = ResetDevicePricesResultSchema.parse(
    await resetDevicePrices(params.data.deviceId),
  );
  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        result,
        result.gamesReset > 0
          ? 'Device price overrides reset successfully'
          : 'No device price overrides to reset',
      ),
    );
});

export const resetPricesForAllDevices = asyncHandler(async (req: Request, res: Response) => {
  assertCompanyAdmin(req);
  const result = ResetAllDevicePricesResultSchema.parse(await resetAllDevicePrices());
  res.status(200).json(new ApiResponse(
    200,
    result,
    result.gamesReset > 0 ? 'All device price overrides reset successfully' : 'No device price overrides to reset',
  ));
});

export const updateDeviceGamePrice = asyncHandler(async (req: Request, res: Response) => {
  const params = DeviceGameParamsSchema.safeParse(req.params);
  if (!params.success) throw new ApiError(400, 'Invalid device or game id', params.error.issues);

  const body = SetDeviceGamePriceSchema.safeParse(req.body);
  if (!body.success) throw new ApiError(400, 'Invalid price payload', body.error.issues);

  await assertDeviceVisible(req, params.data.deviceId);
  try {
    await assertDeviceNotRetired(params.data.deviceId);
  } catch (error) {
    if (error instanceof Error && error.message === 'Retired kiosks cannot receive game price changes') {
      throw new ApiError(409, error.message);
    }
    throw error;
  }

  const games = await getDevicePrices(params.data.deviceId);
  const game = games.find((item) => item.gameId === params.data.gameId);
  if (!game) throw new ApiError(404, 'Game was not found on the selected device');
  // A Partner may request a price change only for machines it holds directly under the
  // Company. Partners under a Distributor stay out of the Company queue: their price
  // changes are the Distributor's to raise.
  const membership = req.membership!;
  const requesterType = membership.type;
  const isCompanyPartner =
    requesterType === 'PARTNER' &&
    (await prisma.organization.findFirst({
      where: { id: membership.organizationId, parentOrg: { type: 'COMPANY' } },
      select: { id: true },
    })) !== null;

  if (requesterType === 'PARTNER' && !isCompanyPartner) {
    // Explicit, because the generic company-admin error would suggest the action is
    // missing rather than routed through someone else.
    throw new ApiError(
      403,
      'Price changes for a Distributor partner go through that Distributor',
    );
  }

  if (requesterType === 'DISTRIBUTOR' || isCompanyPartner) {
    if (!['OWNER', 'ADMIN', 'MANAGER'].includes(membership.role)) {
      throw new ApiError(
        403,
        requesterType === 'PARTNER'
          ? 'Only Partner owners, admins, or managers can request game price changes'
          : 'Only Distributor owners, admins, or managers can request game price changes',
      );
    }
    if (body.data.scope !== 'DEVICE') {
      throw new ApiError(403, 'Price requests apply to one device at a time');
    }
    const existing = await prisma.devicePriceRequest.findFirst({
      where: { deviceId: params.data.deviceId, gameId: game.gameId, requesterOrgId: membership.organizationId, status: { in: ['PENDING', 'PROCESSING'] } },
      select: { id: true },
    });
    if (existing) throw new ApiError(409, 'A pending price request already exists for this game and device');
    const request = await prisma.devicePriceRequest.create({
      data: {
        deviceId: params.data.deviceId,
        gameId: game.gameId,
        displayName: game.displayName,
        price: body.data.price,
        replayPrice: body.data.replay_price ?? game.effectiveReplayPrice,
        requesterOrgId: membership.organizationId,
        requestedById: req.user!.id,
      },
    });
    return res.status(201).json(new ApiResponse(201, { request }, 'Device game price request submitted'));
  }
  assertCompanyAdmin(req);
  if (body.data.scope === 'DEVICE') {
    if (body.data.apply_now) {
      const result = SetDeviceGamePriceResultSchema.parse(await setDeviceGamePrice(params.data.deviceId, params.data.gameId, body.data));
      const supersededSchedules = result.status === 'APPLIED'
        ? await markScheduledUpdatesSuperseded(result.deviceId, result.gameId, result.price, result.replayPrice)
        : 0;
      // The flush is explicit but not guaranteed: if Mothership still reports the change as
      // pending — or stores it while the kiosk's own launcher still serves the old number —
      // say so instead of claiming it went live.
      const applied = result.status !== 'PENDING' && result.kioskServesNewPrice !== false;
      const message = applied
        ? 'Device game price applied live and verified'
        : result.kioskServesNewPrice === false
          ? `Mothership stored the price but the kiosk still serves ${result.kioskServedPrice ?? '?'} / replay ${result.kioskServedReplayPrice ?? '?'}`
          : `Price queued at Mothership for ${result.scheduledFor ?? 'the next scheduled run'}; the kiosk still reads its previous price`;
      return res.status(applied ? 200 : 202).json(new ApiResponse(applied ? 200 : 202, { ...result, appliedNow: applied, supersededSchedules }, message));
    }
    if (body.data.scheduled_date && body.data.scheduled_date < businessDate()) {
      throw new ApiError(400, 'Scheduled date cannot be in the past');
    }
    const update = await scheduleEodDevicePrice({
      deviceId: params.data.deviceId, gameId: game.gameId, displayName: game.displayName,
      price: body.data.price, replayPrice: body.data.replay_price ?? game.effectiveReplayPrice, createdById: req.user!.id,
      ...(body.data.scheduled_date ? { scheduledDate: body.data.scheduled_date } : {}),
      ...(body.data.scheduled_time ? { scheduledTime: body.data.scheduled_time } : {}),
    });
    const scheduledDate = update.businessDate.toISOString().slice(0, 10);
    return res.status(202).json(new ApiResponse(202, {
      deviceId: params.data.deviceId, gameId: game.gameId, displayName: game.displayName,
      currentPrice: game.effectivePrice, currentReplayPrice: game.effectiveReplayPrice,
      price: Number(update.price), replayPrice: Number(update.replayPrice), status: update.status,
      scheduledDate, scheduledTime: update.scheduledTime, scheduledFor: eodRunForDate(scheduledDate, new Date(), update.scheduledTime), timezone: BUSINESS_TIMEZONE, updateId: update.id,
    }, 'Device game price scheduled for EOD application'));
  }
  const result = SetDeviceGamePriceResultSchema.parse(await setDeviceGamePrice(params.data.deviceId, params.data.gameId, body.data));
  // A GAME_CATALOG write overwrites the catalog price that all kiosks inherit. Any pending
  // EOD row for this device+game would re-apply the old scheduled price on top of the catalog
  // write when the job fires, silently reverting "Apply to all kiosks". Cancel them here, the
  // same way `apply_now` does for device-scoped writes.
  const supersededSchedules = result.scope === 'GAME_CATALOG'
    ? await markGameScheduledUpdatesSuperseded(result.gameId)
    : 0;
  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { ...result, supersededSchedules },
        result.scope === 'GAME_CATALOG'
          ? result.devicesNotUpdated?.length
            ? `Game catalog price applied; ${result.devicesNotUpdated.length} kiosk(s) still show their previous price`
            : 'Game catalog price applied to all kiosks and verified'
          : result.status === 'PENDING'
            ? `Device price queued at Mothership for ${result.scheduledFor ?? 'the next scheduled run'}`
            : 'Device game price updated and verified',
      ),
    );
});

const requestParamsSchema = z.object({ requestId: z.string().uuid() });
const reviewBodySchema = z.object({ reason: z.string().trim().min(1).max(1000) });
const approvePriceRequestBodySchema = z.object({
  // Approval decides *when*, never *where*. `ALL_KIOSKS` used to be offered here and
  // executed as a game-catalog write, so approving a partner's per-kiosk request changed the
  // price on every kiosk offering that game — the reported "changes universal" behaviour, and
  // the reason Brick Blast currently reads 1000 on unrelated machines. A fleet price stays
  // available through the explicit company write path with `scope: 'GAME_CATALOG'`.
  mode: z.enum(['APPLY_NOW', 'SCHEDULED']).default('SCHEDULED'),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Scheduled date must use YYYY-MM-DD').optional(),
  scheduled_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Scheduled time must use HH:mm').optional(),
}).superRefine((value, context) => {
  if (value.mode === 'SCHEDULED' && (!value.scheduled_date || !value.scheduled_time)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Scheduled approvals require a date and time' });
  }
});

function assertCompanyAdmin(req: Request) {
  if (req.membership?.type !== 'COMPANY' || !['OWNER', 'ADMIN'].includes(req.membership.role)) {
    throw new ApiError(403, 'Only Company master admins can manage device prices');
  }
}

async function visibleDeviceKiosks(req: Request) {
  if (req.membership!.type === 'COMPANY') return null;
  // Own organization plus the network below it, from the same resolver as the kiosk
  // inventory: a Distributor also sees the machines it placed with its Partners.
  const orgIds = await networkOrgIds(req.membership!.organizationId, req.membership!.type);

  return prisma.kiosk.findMany({
    where: { currentOrgId: { in: orgIds } },
    select: { externalDeviceId: true, machineCode: true },
  });
}

async function assertDeviceVisible(req: Request, deviceId: string) {
  if (req.membership!.type === 'COMPANY') {
    if (!['OWNER', 'ADMIN'].includes(req.membership!.role)) {
      throw new ApiError(403, 'Only Company master admins can view the complete device fleet');
    }
    return;
  }
  const kiosks = await visibleDeviceKiosks(req);
  const owned = kiosks?.some((kiosk) => kiosk.externalDeviceId === deviceId || kiosk.machineCode === deviceId);
  if (!owned) throw new ApiError(404, 'Device is not assigned to your organization');
}

async function visibleDevices(req: Request, devices: Awaited<ReturnType<typeof listDevices>>['devices']) {
  if (req.membership!.type === 'COMPANY') {
    if (!['OWNER', 'ADMIN'].includes(req.membership!.role)) {
      throw new ApiError(403, 'Only Company master admins can view the complete device fleet');
    }
    return devices;
  }
  const kiosks = await visibleDeviceKiosks(req);
  const allowed = new Set(kiosks?.flatMap((kiosk) => [kiosk.externalDeviceId, kiosk.machineCode].filter(Boolean)));
  return devices.filter((device) => allowed.has(device.deviceId));
}

function serializePriceRequest(request: {
  id: string; deviceId: string; gameId: string; displayName: string;
  price: unknown; replayPrice: unknown; requesterOrgId: string; requestedById: string;
  status: string; processingAt: Date | null; reviewNote: string | null; reviewedById: string | null;
  reviewedAt: Date | null; createdAt: Date; updatedAt: Date;
}) {
  return {
    ...request,
    price: Number(request.price),
    replayPrice: Number(request.replayPrice),
  };
}

export const getDevicePriceRequests = asyncHandler(async (req: Request, res: Response) => {
  assertPriceRequestViewer(req);
  // A crashed approval must not leave a request invisible forever.
  await prisma.devicePriceRequest.updateMany({
    where: {
      status: 'PROCESSING',
      processingAt: { lt: new Date(Date.now() - 10 * 60 * 1000) },
    },
    data: { status: 'PENDING', processingAt: null, reviewNote: 'Previous approval attempt timed out; ready to retry.' },
  });
  const requestInclude = {
      requesterOrg: { select: { id: true, name: true, type: true } },
      requestedBy: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { id: true, name: true } },
  } as const;
  const requests = req.membership!.type === 'COMPANY'
    ? await prisma.devicePriceRequest.findMany({ orderBy: { createdAt: 'desc' }, include: requestInclude })
    : await prisma.devicePriceRequest.findMany({ where: { requesterOrgId: req.membership!.organizationId }, orderBy: { createdAt: 'desc' }, include: requestInclude });
  const visibleRequests = [];
  for (const request of requests) {
    // A Distributor also sees its own submissions read-only so it can tell what is still
    // waiting on the Company; the approve and reject routes refuse those regardless.
    const ownSubmission = request.requesterOrgId === req.membership!.organizationId;
    if (ownSubmission || (await canReviewPriceRequest(req, request.requesterOrg.type, request.requesterOrg.id))) visibleRequests.push(request);
  }
  res.json(new ApiResponse(200, {
    requests: visibleRequests.map((request) => ({ ...serializePriceRequest(request), requesterOrg: request.requesterOrg, requestedBy: request.requestedBy, reviewedBy: request.reviewedBy })),
  }, 'Device price requests fetched successfully'));
});

export const approveDevicePriceRequest = asyncHandler(async (req: Request, res: Response) => {
  const params = requestParamsSchema.safeParse(req.params);
  if (!params.success) throw new ApiError(400, 'Invalid price request id', params.error.issues);
  const body = approvePriceRequestBodySchema.safeParse(req.body ?? {});
  if (!body.success) throw new ApiError(400, 'Invalid price approval options', body.error.issues);
  const request = await prisma.devicePriceRequest.findUnique({ where: { id: params.data.requestId } });
  if (!request) throw new ApiError(404, 'Price request not found');
  await assertCanReviewPriceRequest(req, request.requesterOrgId);
  const claimed = await prisma.devicePriceRequest.updateMany({
    where: { id: request.id, status: 'PENDING' },
    data: { status: 'PROCESSING', processingAt: new Date() },
  });
  if (claimed.count !== 1) throw new ApiError(409, 'This price request has already been reviewed');
  try {
    // The device must still sit inside the requester's network: the Distributor's own
    // machines or its direct Partners'. A Distributor may request a price for a machine
    // it placed with a Partner, so its own org id alone is too narrow here.
    const requesterOrgIds: string[] = [request.requesterOrgId];
    const requester = await prisma.organization.findUnique({
      where: { id: request.requesterOrgId },
      select: { type: true },
    });
    if (requester?.type === 'DISTRIBUTOR') {
      const partnerChildren = await prisma.organization.findMany({
        where: { parentOrgId: request.requesterOrgId, type: 'PARTNER', isActive: true },
        select: { id: true },
      });
      requesterOrgIds.push(...partnerChildren.map((partner) => partner.id));
    }
    const ownedKiosk = await prisma.kiosk.findFirst({
      where: {
        AND: [
          { OR: [{ externalDeviceId: request.deviceId }, { machineCode: request.deviceId }] },
          // currentOrgId is the fast path, but the active assignment ledger is the
          // source of truth for machines moved through Distributor/Partner delivery.
          {
            OR: [
              { currentOrgId: { in: requesterOrgIds } },
              { assignments: { some: { organizationId: { in: requesterOrgIds }, assignedTo: null } } },
            ],
          },
        ],
      },
      select: { id: true, status: true },
    });
    if (!ownedKiosk) {
      throw new ApiError(409, 'The requested device is no longer assigned to that organization');
    }
    if (ownedKiosk.status === 'RETIRED') {
      throw new ApiError(409, 'Retired kiosks cannot receive game price changes');
    }
    const price = Number(request.price);
    const replayPrice = Number(request.replayPrice);
    if (body.data.mode === 'APPLY_NOW') {
      const result = await setDeviceGamePrice(request.deviceId, request.gameId, {
        price,
        replay_price: replayPrice,
        scope: 'DEVICE',
        apply_now: true,
      });
      // An immediate write supersedes any still-queued EOD row for this device+game.
      // The direct write path below has always done this; the approval path did not, so an
      // approved request read as applied and then the next scheduled run re-applied the
      // older queued price on top of it.
      await markScheduledUpdatesSuperseded(result.deviceId, result.gameId, price, replayPrice);
    } else {
      await scheduleEodDevicePrice({
        deviceId: request.deviceId,
        gameId: request.gameId,
        displayName: request.displayName,
        price,
        replayPrice,
        createdById: request.requestedById,
        scheduledDate: body.data.scheduled_date!,
        scheduledTime: body.data.scheduled_time!,
      });
    }
    const approved = await prisma.devicePriceRequest.update({
      where: { id: request.id },
      data: { status: 'APPROVED', processingAt: null, reviewedById: req.user!.id, reviewedAt: new Date(), reviewNote: body.data.mode },
    });
    const message = body.data.mode === 'APPLY_NOW'
      ? 'Price request approved and applied now'
      : 'Price request approved and scheduled';
    res.json(new ApiResponse(200, { request: serializePriceRequest(approved) }, message));
  } catch (error) {
    await prisma.devicePriceRequest.updateMany({
      where: { id: request.id, status: 'PROCESSING' },
      data: { status: 'PENDING', processingAt: null, reviewNote: 'The previous approval attempt failed; it is ready to retry.' },
    });
    throw error;
  }
});

export const rejectDevicePriceRequest = asyncHandler(async (req: Request, res: Response) => {
  const params = requestParamsSchema.safeParse(req.params);
  if (!params.success) throw new ApiError(400, 'Invalid price request id', params.error.issues);
  const existing = await prisma.devicePriceRequest.findUnique({ where: { id: params.data.requestId }, select: { requesterOrgId: true } });
  if (!existing) throw new ApiError(404, 'Price request not found');
  await assertCanReviewPriceRequest(req, existing.requesterOrgId);
  const body = reviewBodySchema.safeParse(req.body);
  if (!body.success) throw new ApiError(400, 'A rejection reason is required', body.error.issues);
  const rejected = await prisma.devicePriceRequest.updateMany({
    where: { id: params.data.requestId, status: 'PENDING' },
    data: { status: 'REJECTED', reviewedById: req.user!.id, reviewedAt: new Date(), reviewNote: body.data.reason },
  });
  if (rejected.count !== 1) throw new ApiError(409, 'This price request has already been reviewed');
  const request = await prisma.devicePriceRequest.findUniqueOrThrow({ where: { id: params.data.requestId } });
  res.json(new ApiResponse(200, { request: serializePriceRequest(request) }, 'Price request rejected'));
});

function assertPriceRequestReviewer(req: Request) {
  if (!req.membership || !['COMPANY', 'DISTRIBUTOR'].includes(req.membership.type) || !['OWNER', 'ADMIN'].includes(req.membership.role)) {
    throw new ApiError(403, 'Only Company or Distributor admins can review price requests');
  }
}

function assertPriceRequestViewer(req: Request) {
  if (!req.membership || !['COMPANY', 'DISTRIBUTOR', 'PARTNER'].includes(req.membership.type) || !['OWNER', 'ADMIN', 'MANAGER'].includes(req.membership.role)) {
    throw new ApiError(403, 'Only organization owners, admins, or managers can view price requests');
  }
}

async function canReviewPriceRequest(req: Request, requesterType: string, requesterOrgId: string) {
  if (req.membership!.type === 'COMPANY') return requesterType === 'DISTRIBUTOR' || requesterType === 'PARTNER';
  if (requesterType !== 'PARTNER') return false;
  const agreement = await prisma.agreement.findFirst({
    where: { parentOrgId: req.membership!.organizationId, childOrgId: requesterOrgId, status: 'ACTIVE' },
    select: { id: true },
  });
  return Boolean(agreement);
}

async function assertCanReviewPriceRequest(req: Request, requesterOrgId: string) {
  assertPriceRequestReviewer(req);
  const requester = await prisma.organization.findUnique({ where: { id: requesterOrgId }, select: { type: true } });
  if (!requester || !(await canReviewPriceRequest(req, requester.type, requesterOrgId))) {
    throw new ApiError(403, 'This price request is not assigned to your organization');
  }
}
