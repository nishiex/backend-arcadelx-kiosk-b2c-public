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
import {
  getDevicePrices,
  listDevices,
  resetDevicePrices,
  resetAllDevicePrices,
  setDeviceGamePrice,
} from '../../services/Mothership/devices.service';
import { assertDeviceNotRetired, BUSINESS_TIMEZONE, businessDate, eodRunForDate, getEodPricingTime, markScheduledUpdatesSuperseded, nextEod, pricingStatus, scheduleEodDevicePrice } from '../../services/Mothership/eod-pricing.service';

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
  const devices = await visibleDevices(req, upstreamDevices);
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
  const eod = await Promise.all(games.map(async game => ({ gameId: game.gameId, update: await pricingStatus(parsed.data.deviceId, game.gameId) })));
  const kiosk = await prisma.kiosk.findFirst({
    where: { OR: [{ externalDeviceId: parsed.data.deviceId }, { machineCode: parsed.data.deviceId }] },
    select: { status: true },
  });
  res
    .status(200)
    .json(new ApiResponse(200, { deviceId: parsed.data.deviceId, games, kioskStatus: kiosk?.status ?? null, eod: Object.fromEntries(eod.map(item => [item.gameId, item.update])), eodMeta: { timezone: BUSINESS_TIMEZONE, runTime: getEodPricingTime(), nextExecutionAt: nextEod() } }, 'Prices fetched successfully'));
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
      const supersededSchedules = await markScheduledUpdatesSuperseded(result.deviceId, result.gameId, result.price, result.replayPrice);
      // The flush is explicit but not guaranteed: if Mothership still reports the change as
      // pending, say so instead of claiming it went live.
      const applied = result.status !== 'PENDING';
      const message = applied
        ? 'Device game price applied live and verified'
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
  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        result,
        result.scope === 'GAME_CATALOG'
          ? 'Game catalog price applied to all kiosks and verified'
          : result.status === 'PENDING'
            ? `Device price queued at Mothership for ${result.scheduledFor ?? 'the next scheduled run'}`
            : 'Device game price updated and verified',
      ),
    );
});

const requestParamsSchema = z.object({ requestId: z.string().uuid() });
const reviewBodySchema = z.object({ reason: z.string().trim().min(1).max(1000) });

function assertCompanyAdmin(req: Request) {
  if (req.membership?.type !== 'COMPANY' || !['OWNER', 'ADMIN'].includes(req.membership.role)) {
    throw new ApiError(403, 'Only Company master admins can manage device prices');
  }
}

async function visibleDeviceKiosks(req: Request) {
  if (req.membership!.type === 'COMPANY') return null;
  // A Distributor's fleet covers its direct Partners' machines too, mirroring the kiosk
  // inventory scope: without the partner rows a Distributor whose own machines are still
  // in transit sees an empty fleet and can never request a price for a placed machine.
  const orgIds: string[] = [req.membership!.organizationId];
  if (req.membership!.type === 'DISTRIBUTOR') {
    const partners = await prisma.organization.findMany({
      where: { parentOrgId: req.membership!.organizationId, type: 'PARTNER', isActive: true },
      select: { id: true },
    });
    orgIds.push(...partners.map((partner) => partner.id));
  }
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
  assertPriceRequestReviewer(req);
  // A crashed approval must not leave a request invisible forever.
  await prisma.devicePriceRequest.updateMany({
    where: {
      status: 'PROCESSING',
      processingAt: { lt: new Date(Date.now() - 10 * 60 * 1000) },
    },
    data: { status: 'PENDING', processingAt: null, reviewNote: 'Previous approval attempt timed out; ready to retry.' },
  });
  const requests = await prisma.devicePriceRequest.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      requesterOrg: { select: { id: true, name: true, type: true } },
      requestedBy: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { id: true, name: true } },
    },
  });
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
        currentOrgId: { in: requesterOrgIds },
        OR: [{ externalDeviceId: request.deviceId }, { machineCode: request.deviceId }],
      },
      select: { id: true, status: true },
    });
    if (!ownedKiosk) {
      throw new ApiError(409, 'The requested device is no longer assigned to that organization');
    }
    if (ownedKiosk.status === 'RETIRED') {
      throw new ApiError(409, 'Retired kiosks cannot receive game price changes');
    }
    await scheduleEodDevicePrice({ deviceId: request.deviceId, gameId: request.gameId, displayName: request.displayName, price: Number(request.price), replayPrice: Number(request.replayPrice), createdById: request.requestedById });
    const approved = await prisma.devicePriceRequest.update({
      where: { id: request.id },
      data: { status: 'APPROVED', processingAt: null, reviewedById: req.user!.id, reviewedAt: new Date(), reviewNote: null },
    });
    res.json(new ApiResponse(200, { request: serializePriceRequest(approved) }, 'Price request approved and applied'));
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
