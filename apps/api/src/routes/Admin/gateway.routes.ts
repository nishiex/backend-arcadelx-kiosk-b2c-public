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
 * Gateway configuration is sensitive payment infrastructure. Company OWNER is the
 * application's Master Admin and is the only role allowed to mutate provider payloads;
 * Company ADMIN may only read the current configuration.
 *
 * Note the path prefix is `/api/admin`, not Mothership's `/api/v1/admin`: this is our
 * own surface, and keeping our versioning out of the path avoids implying we mirror
 * Mothership's API versioning.
 */
const router = Router();

router.use(requireAuth, loadMembership, requireOrgType('COMPANY'));

// Current gateway configuration (priority order and active state).
router.get('/', requireRole('OWNER', 'ADMIN'), getGateways);

// Only the Company OWNER (Master Admin) may create or update provider credentials.
router.post('/', requireRole('OWNER'), createOrUpdateGateway);

// Only the Company OWNER (Master Admin) may change the routing priority order.
router.post('/reorder', requireRole('OWNER'), reorderGatewayPriorities);

// Only the Company OWNER (Master Admin) may enable or disable a provider.
router.post('/toggle', requireRole('OWNER'), toggleGatewayState);

// Only the Company OWNER (Master Admin) may remove a provider override.
router.delete('/', requireRole('OWNER'), removeGateway);

export default router;
