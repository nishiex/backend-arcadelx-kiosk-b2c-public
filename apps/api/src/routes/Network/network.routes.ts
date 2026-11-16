import { Router } from 'express';
import { initiateConnection, acceptConnection, getConnections, deleteConnection, getPendingNetworkRequests, getDistributors, getPartners } from '../../controllers/Network/network.controller';
import { requireAuth, loadMembership, requireRole, requireOrgType } from '../../middlewares/auth';

const router = Router();

router.use(requireAuth, loadMembership);
// Network request history is a Company Master Admin view. Other organizations
// continue to use their scoped agreement/order surfaces for decisions.
router.get('/', requireOrgType('COMPANY'), requireRole('OWNER'), getConnections);

//ONLY COMPANY AND DISTRIBUTOR CAN SEND CONNECTION REQUESTS
router.post('/initiate', requireOrgType("COMPANY","DISTRIBUTOR"),requireRole('OWNER', 'ADMIN'), initiateConnection);

router.get("/requests", requireOrgType('COMPANY'), requireRole("OWNER"), getPendingNetworkRequests)

// Company-only listing of distributor organizations for the dashboard.
// Partners read this to see the Distributor they belong to; the controller scopes them.
router.get('/distributors', requireOrgType('COMPANY', 'PARTNER'), getDistributors);
router.get('/partners', requireOrgType('COMPANY', 'DISTRIBUTOR'), requireRole('OWNER', 'ADMIN', 'MANAGER'), getPartners);

router.post('/:connectionId/accept', requireRole('OWNER', 'ADMIN'), acceptConnection);

router.delete('/:connectionId',requireOrgType("COMPANY","DISTRIBUTOR"), requireRole('OWNER'), deleteConnection);

export default router;
