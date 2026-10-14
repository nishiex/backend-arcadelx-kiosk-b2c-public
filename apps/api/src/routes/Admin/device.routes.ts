import { Router } from 'express';
import {
  requireAuth,
  loadMembership,
  requireOrgType,
  requireRole,
} from '../../middlewares/auth';
import {
  getDevices,
  getPricesForDevice,
  resetPricesForDevice,
  updateDeviceGamePrice,
  getDevicePriceRequests,
  approveDevicePriceRequest,
  rejectDevicePriceRequest,
} from '../../controllers/Admin/device.controller';

/**
 * Device fleet and game pricing, proxied to Mothership.
 *
 * Reads require an authenticated member of a COMPANY, DISTRIBUTOR or PARTNER org, matching
 * the revenue endpoints: the device fleet is operational data the network already sees.
 *
 * Company OWNER/ADMIN can apply prices directly. Distributor/Partner members can submit
 * device-scoped requests for Company approval; only Company master admins can apply a
 * device price or change the game catalog for every kiosk.
 *
 * Note the path prefix is `/api/devices`, not Mothership's `/api/v1/devices`: this is our
 * own surface, and keeping our versioning out of the path avoids implying we mirror
 * Mothership's API versioning.
 */
const router = Router();

router.use(requireAuth, loadMembership);

// Company master-admin approval queue for Distributor/Partner price requests.
router.get('/price-requests', requireOrgType('COMPANY'), requireRole('OWNER', 'ADMIN'), getDevicePriceRequests);
router.patch('/price-requests/:requestId/approve', requireOrgType('COMPANY'), requireRole('OWNER', 'ADMIN'), approveDevicePriceRequest);
router.patch('/price-requests/:requestId/reject', requireOrgType('COMPANY'), requireRole('OWNER', 'ADMIN'), rejectDevicePriceRequest);

// The fleet as Mothership reports it (online state, last seen, location).
router.get(
  '/',
  requireOrgType('COMPANY', 'DISTRIBUTOR', 'PARTNER'),
  requireRole('OWNER', 'ADMIN', 'MANAGER'),
  getDevices,
);

// Every game's price on one device, with duplicate upstream rows merged.
router.get(
  '/:deviceId/prices',
  requireOrgType('COMPANY', 'DISTRIBUTOR', 'PARTNER'),
  requireRole('OWNER', 'ADMIN', 'MANAGER'),
  getPricesForDevice,
);

// Reset price overrides for this device only. It does not change catalog prices or other
// devices, and is restricted to the same Company OWNER/ADMIN roles as price writes.
router.post(
  '/:deviceId/prices/reset',
  requireOrgType('COMPANY'),
  requireRole('OWNER', 'ADMIN'),
  resetPricesForDevice,
);

// Price writes are gated to Company OWNER/ADMIN. `scope: 'GAME_CATALOG'` in the body updates
// the game's catalog price for every kiosk; a device write never falls back to it.
router.post(
  '/:deviceId/games/:gameId/price',
  requireOrgType('COMPANY', 'DISTRIBUTOR', 'PARTNER'),
  requireRole('OWNER', 'ADMIN', 'MANAGER'),
  updateDeviceGamePrice,
);

export default router;
