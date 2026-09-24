import { Router } from 'express';
import { initiateConnection, acceptConnection, deleteConnection, getPendingNetworkRequests, getDistributors } from '../../controllers/Network/network.controller';
import { requireAuth, loadMembership, requireRole, requireOrgType } from '../../middlewares/auth';

const router = Router();

router.use(requireAuth, loadMembership);

//ONLY COMPANY AND DISTRIBUTOR CAN SEND CONNECTION REQUESTS
router.post('/initiate', requireOrgType("COMPANY","DISTRIBUTOR"),requireRole('OWNER', 'ADMIN'), initiateConnection);

router.get("/requests",requireRole("OWNER","ADMIN"),getPendingNetworkRequests)

// Company-only listing of distributor organizations for the dashboard.
router.get('/distributors', requireOrgType('COMPANY'), getDistributors);

router.post('/:connectionId/accept', requireRole('OWNER', 'ADMIN'), acceptConnection);

router.delete('/:connectionId',requireOrgType("COMPANY","DISTRIBUTOR"), requireRole('OWNER'), deleteConnection);

export default router;