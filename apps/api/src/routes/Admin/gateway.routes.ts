import { Router } from 'express';
import {
  requireAuth,
  loadMembership,
  requireOrgType,
  requireRole,
} from '../../middlewares/auth';
import {
  createOrUpdateGateway,
  getGateways,
  removeGateway,
  reorderGatewayPriorities,
  toggleGatewayState,
} from '../../controllers/Admin/gateway.controller';

/**
 * Payment-gateway administration, proxied to Mothership.
 *
 * Access follows the same shape as the revenue rate editing: only the Company's
 * OWNER/ADMIN. A gateway change alters live payment routing, so it is deliberately
 * narrower than the read-only revenue endpoints.
 *
 * Note the path prefix is `/api/admin`, not Mothership's `/api/v1/admin`: this is our
 * own surface, and keeping our versioning out of the path avoids implying we mirror
 * Mothership's API versioning.
 */
const router = Router();

router.use(requireAuth, loadMembership, requireOrgType('COMPANY'), requireRole('OWNER', 'ADMIN'));

// Current gateway configuration (priority order and active state).
router.get('/', getGateways);

// Create or update one provider's configuration.
router.post('/', createOrUpdateGateway);

// Set the routing priority order.
router.post('/reorder', reorderGatewayPriorities);

// Enable or disable one provider.
router.post('/toggle', toggleGatewayState);

// Remove one provider's override.
router.delete('/', removeGateway);

export default router;
