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
  updateDeviceGamePrice,
} from '../../controllers/Admin/device.controller';

/**
 * Device fleet and game pricing, proxied to Mothership.
 *
 * Reads require an authenticated member of a COMPANY, DISTRIBUTOR or PARTNER org, matching
 * the revenue endpoints: the device fleet is operational data the network already sees.
 *
 * The price WRITE is narrower — Company OWNER/ADMIN only. It changes what physically
 * deployed kiosks charge, so it is treated like the revenue rate editing and the gateway
 * admin surface rather than as ordinary operational data. Note its scope: Mothership stores
 * one price per GAME, so the write reaches every kiosk offering that game, not just the
 * device named in the path (which is used to read the change back and confirm it).
 *
 * Note the path prefix is `/api/devices`, not Mothership's `/api/v1/devices`: this is our
 * own surface, and keeping our versioning out of the path avoids implying we mirror
 * Mothership's API versioning.
 */
const router = Router();

router.use(requireAuth, loadMembership);

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

// Set one game's price. This writes to live hardware, and because Mothership stores one
// price per game it applies to every kiosk offering that game.
router.post(
  '/:deviceId/games/:gameId/price',
  requireOrgType('COMPANY'),
  requireRole('OWNER', 'ADMIN'),
  updateDeviceGamePrice,
);

export default router;
