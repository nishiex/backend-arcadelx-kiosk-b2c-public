import type { Request, Response } from 'express';
import { ApiError } from '../../utils/ApiError';
import { ApiResponse } from '../../utils/ApiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  DeleteGatewaySchema,
  ReorderGatewaysSchema,
  ToggleGatewaySchema,
  UpsertGatewaySchema,
} from '@shared-types/validationSchemas/Gateways/gateway.validation';
import {
  deleteGateway,
  listGateways,
  reorderGateways,
  toggleGateway,
  upsertGateway,
} from '../../services/Mothership/gateways.service';
import { verifyTotpCode } from '../../utils/totp';

function requireGatewayTotp(code: string | undefined): void {
  const secret = process.env.GATEWAY_TOTP_SECRET;
  if (!secret) {
    throw new ApiError(503, 'Gateway TOTP verification is not configured');
  }
  if (!code || !verifyTotpCode(secret, code)) {
    throw new ApiError(403, 'Invalid or expired gateway authentication code');
  }
}

/**
 * Payment-gateway administration.
 *
 * Everything here is gated in `routes/Admin/gateway.routes.ts` by our own session
 * auth plus COMPANY OWNER/ADMIN. That gate is the point of this surface: Mothership
 * serves `GET /api/v1/admin/gateways` to anyone who asks, so without it the routing
 * configuration of a live payment system would be world-readable, and reorder/toggle
 * would be world-writable.
 *
 * Inputs are validated before forwarding, so a bad request fails here with a clear
 * 400 rather than as an opaque upstream error.
 */

export const getGateways = asyncHandler(async (_req: Request, res: Response) => {
  const { total, gateways } = await listGateways();
  res.status(200).json(new ApiResponse(200, { total, gateways }, 'Gateways fetched successfully'));
});

export const createOrUpdateGateway = asyncHandler(async (req: Request, res: Response) => {
  const parsed = UpsertGatewaySchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'Invalid gateway payload', parsed.error.issues);

  const result = await upsertGateway(parsed.data);
  res.status(200).json(new ApiResponse(200, result, 'Gateway saved successfully'));
});

export const reorderGatewayPriorities = asyncHandler(async (req: Request, res: Response) => {
  const parsed = ReorderGatewaysSchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'Invalid reorder payload', parsed.error.issues);

  const result = await reorderGateways(parsed.data);
  res.status(200).json(new ApiResponse(200, result, 'Gateway priority updated successfully'));
});

export const toggleGatewayState = asyncHandler(async (req: Request, res: Response) => {
  const parsed = ToggleGatewaySchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'Invalid toggle payload', parsed.error.issues);

  if (!parsed.data.is_active) requireGatewayTotp(parsed.data.totpCode);

  // Never forward the local TOTP code to Mothership.
  const result = await toggleGateway({
    provider: parsed.data.provider,
    is_active: parsed.data.is_active,
  });
  res
    .status(200)
    .json(new ApiResponse(200, result, `Gateway ${parsed.data.is_active ? 'enabled' : 'disabled'} successfully`));
});

export const removeGateway = asyncHandler(async (req: Request, res: Response) => {
  const parsed = DeleteGatewaySchema.safeParse(req.body);
  if (!parsed.success) throw new ApiError(400, 'Invalid delete payload', parsed.error.issues);

  requireGatewayTotp(parsed.data.totpCode);

  const result = await deleteGateway(parsed.data);
  const message =
    typeof result === 'object' && result !== null && 'fallback' in result
      ? 'Gateway disabled successfully (upstream does not support removal)'
      : 'Gateway removed successfully';
  res.status(200).json(new ApiResponse(200, result, message));
});
