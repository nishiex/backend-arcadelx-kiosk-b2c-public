import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError';
import { ApiResponse } from '../../utils/ApiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  DeviceGameParamsSchema,
  DeviceParamsSchema,
  SetDeviceGamePriceSchema,
} from '@shared-types/validationSchemas/Devices/device.validation';
import {
  getDevicePrices,
  listDevices,
  setDeviceGamePrice,
} from '../../services/Mothership/devices.service';

/**
 * Device fleet and per-device game pricing.
 *
 * Reads are open to any signed-in member of the organization, because they describe
 * hardware the fleet operator already owns. The price WRITE is the sensitive one: it
 * changes what a live kiosk charges a player, so its route additionally requires the
 * Company's OWNER/ADMIN (`routes/Device/device.routes.ts`).
 *
 * Params and body are validated here before anything is forwarded, so a malformed
 * request fails with a specific 400 instead of an opaque upstream error.
 */

export const getDevices = asyncHandler(async (_req: Request, res: Response) => {
  const { devices, lastUpdated } = await listDevices();
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

  const games = await getDevicePrices(parsed.data.deviceId);
  res
    .status(200)
    .json(new ApiResponse(200, { deviceId: parsed.data.deviceId, games }, 'Prices fetched successfully'));
});

export const updateDeviceGamePrice = asyncHandler(async (req: Request, res: Response) => {
  const params = DeviceGameParamsSchema.safeParse(req.params);
  if (!params.success) throw new ApiError(400, 'Invalid device or game id', params.error.issues);

  const body = SetDeviceGamePriceSchema.safeParse(req.body);
  if (!body.success) throw new ApiError(400, 'Invalid price payload', body.error.issues);

  const result = await setDeviceGamePrice(
    params.data.deviceId,
    params.data.gameId,
    body.data,
  );
  res
    .status(200)
    .json(new ApiResponse(200, result, 'Game price updated successfully'));
});
