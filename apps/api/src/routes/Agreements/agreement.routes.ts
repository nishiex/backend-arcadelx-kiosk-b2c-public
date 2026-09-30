import { Router } from 'express';
import { createAgreement, approveAgreement, rejectAgreement, getAgreements, terminateAgreement } from '../../controllers/Agreement/agreement.controller'
import { requireAuth, loadMembership, requireRole ,requireOrgType } from '../../middlewares/auth';

const router = Router();

router.use(requireAuth, loadMembership);
router.get('/', requireRole('OWNER', 'ADMIN'), getAgreements);

// ONLY Owners can handle financial agreements

router.post('/create',requireOrgType("COMPANY","DISTRIBUTOR"), requireRole("OWNER") ,createAgreement);
router.patch('/:agreementId/approve', requireRole("OWNER"),approveAgreement);
router.patch('/:agreementId/reject', requireRole('OWNER'), rejectAgreement);
router.delete('/:agreementId/terminate', requireOrgType("COMPANY","DISTRIBUTOR") ,requireRole("OWNER"),terminateAgreement);

export default router;
