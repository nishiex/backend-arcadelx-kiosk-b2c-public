import { Router } from 'express';
import { createAgreement, approveAgreement, terminateAgreement } from '../../controllers/Agreement/agreement.controller'
import { requireAuth, loadMembership, requireRole ,requireOrgType } from '../../middlewares/auth';

const router = Router();

router.use(requireAuth, loadMembership);

// ONLY Owners can handle financial agreements

router.post('/',requireOrgType("COMPANY","DISTRIBUTOR"), requireRole("OWNER") ,createAgreement);
router.patch('/:agreementId/approve', requireRole("OWNER"),approveAgreement);
router.delete('/:agreementId/terminate', requireOrgType("COMPANY","DISTRIBUTOR") ,requireRole("OWNER"),terminateAgreement);

export default router;