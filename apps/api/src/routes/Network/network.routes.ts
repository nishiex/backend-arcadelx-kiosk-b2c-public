import { Router } from 'express';
import { initiateConnection, acceptConnection, rejectConnection, getConnections, deleteConnection, getPendingNetworkRequests, getDistributors, setDistributorStatus } from '../../controllers/Network/network.controller';
import { requireAuth, loadMembership, requireRole, requireOrgType } from '../../middlewares/auth';

const router = Router();

router.use(requireAuth, loadMembership);
router.get('/', requireRole('OWNER', 'ADMIN'), getConnections);

//ONLY COMPANY AND DISTRIBUTOR CAN SEND CONNECTION REQUESTS
router.post('/initiate', requireOrgType("COMPANY","DISTRIBUTOR"),requireRole('OWNER', 'ADMIN'), initiateConnection);

router.get("/requests",requireRole("OWNER","ADMIN"),getPendingNetworkRequests)

// Company-only listing of distributor organizations for the dashboard.
router.get('/distributors', requireOrgType('COMPANY'), getDistributors);
router.patch('/distributors/:distributorId/status', requireOrgType('COMPANY'), requireRole('OWNER', 'ADMIN'), setDistributorStatus);

router.post('/:connectionId/accept', requireRole('OWNER', 'ADMIN'), acceptConnection);
router.post('/:connectionId/reject', requireRole('OWNER', 'ADMIN'), rejectConnection);

router.delete('/:connectionId',requireOrgType("COMPANY","DISTRIBUTOR"), requireRole('OWNER'), deleteConnection);

export default router;
