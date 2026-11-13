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
  resetPricesForAllDevices,
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
 * Company OWNER/ADMIN can apply prices directly. Distributor OWNER/ADMIN/MANAGER members
 * can submit device-scoped requests for Company approval; only Company master admins can
 * apply a device price or change the game catalog for every kiosk.
 *
 * Note the path prefix is `/api/devices`, not Mothership's `/api/v1/devices`: this is our
 * own surface, and keeping our versioning out of the path avoids implying we mirror
 * Mothership's API versioning.
 */
const router = Router();

router.use(requireAuth, loadMembership);

// Company admins review Distributor requests; Distributor admins review requests from
// their connected Partners. Partners never receive an approval action.
router.get('/price-requests', requireOrgType('COMPANY', 'DISTRIBUTOR', 'PARTNER'), requireRole('OWNER', 'ADMIN', 'MANAGER'), getDevicePriceRequests);
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
  '/prices/reset-all',
  requireOrgType('COMPANY'),
  requireRole('OWNER', 'ADMIN'),
  resetPricesForAllDevices,
);

router.post(
  '/:deviceId/prices/reset',
  requireOrgType('COMPANY'),
  requireRole('OWNER', 'ADMIN'),
  resetPricesForDevice,
);

// The same operation with the verb in the path. Clients that address the reset as a
// DELETE on the device's prices (rather than a POST on /reset) reach the identical
// handler, so there is still one implementation and one set of guards.
router.delete(
  '/:deviceId/prices/reset',
  requireOrgType('COMPANY'),
  requireRole('OWNER', 'ADMIN'),
  resetPricesForDevice,
);

router.delete(
  '/:deviceId/prices',
  requireOrgType('COMPANY'),
  requireRole('OWNER', 'ADMIN'),
  resetPricesForDevice,
);

// Price writes are gated to Company OWNER/ADMIN. `scope: 'GAME_CATALOG'` in the body updates
// the game's catalog price for every kiosk; a device write never falls back to it.
router.post(
  '/:deviceId/games/:gameId/price',
  // PARTNER is admitted here so a Partner that sits directly under the Company can
  // submit a request; the controller rejects Partners that belong to a Distributor.
  requireOrgType('COMPANY', 'DISTRIBUTOR', 'PARTNER'),
  requireRole('OWNER', 'ADMIN', 'MANAGER'),
  updateDeviceGamePrice,
);

export default router;
