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
import { BUSINESS_TIMEZONE, nextEod, pricingStatus, scheduleEodDevicePrice } from '../../services/Mothership/eod-pricing.service';

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
  res
    .status(200)
    .json(new ApiResponse(200, { deviceId: parsed.data.deviceId, games, eod: Object.fromEntries(eod.map(item => [item.gameId, item.update])), eodMeta: { timezone: BUSINESS_TIMEZONE, nextExecutionAt: nextEod() } }, 'Prices fetched successfully'));
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

  const games = await getDevicePrices(params.data.deviceId);
  const game = games.find((item) => item.gameId === params.data.gameId);
  if (!game) throw new ApiError(404, 'Game was not found on the selected device');
  if (req.membership?.type === 'DISTRIBUTOR') {
    if (!['OWNER', 'ADMIN', 'MANAGER'].includes(req.membership.role)) {
      throw new ApiError(403, 'Only Distributor owners, admins, or managers can request game price changes');
    }
    if (body.data.scope !== 'DEVICE') {
      throw new ApiError(403, 'Distributors can request device prices only');
    }
    const existing = await prisma.devicePriceRequest.findFirst({
      where: { deviceId: params.data.deviceId, gameId: game.gameId, requesterOrgId: req.membership.organizationId, status: { in: ['PENDING', 'PROCESSING'] } },
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
        requesterOrgId: req.membership.organizationId,
        requestedById: req.user!.id,
      },
    });
    return res.status(201).json(new ApiResponse(201, { request }, 'Device game price request submitted'));
  }
  assertCompanyAdmin(req);
  if (body.data.scope === 'DEVICE') {
    const update = await scheduleEodDevicePrice({
      deviceId: params.data.deviceId, gameId: game.gameId, displayName: game.displayName,
      price: body.data.price, replayPrice: body.data.replay_price ?? game.effectiveReplayPrice, createdById: req.user!.id,
    });
    return res.status(202).json(new ApiResponse(202, {
      deviceId: params.data.deviceId, gameId: game.gameId, displayName: game.displayName,
      currentPrice: game.effectivePrice, currentReplayPrice: game.effectiveReplayPrice,
      price: Number(update.price), replayPrice: Number(update.replayPrice), status: update.status,
      scheduledFor: nextEod(), timezone: BUSINESS_TIMEZONE, updateId: update.id,
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
  return prisma.kiosk.findMany({
    where: { currentOrgId: req.membership!.organizationId },
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
    if (await canReviewPriceRequest(req, request.requesterOrg.type, request.requesterOrg.id)) visibleRequests.push(request);
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
    const ownedKiosk = await prisma.kiosk.findFirst({
      where: {
        currentOrgId: request.requesterOrgId,
        OR: [{ externalDeviceId: request.deviceId }, { machineCode: request.deviceId }],
      },
      select: { id: true },
    });
    if (!ownedKiosk) {
      throw new ApiError(409, 'The requested device is no longer assigned to that organization');
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
