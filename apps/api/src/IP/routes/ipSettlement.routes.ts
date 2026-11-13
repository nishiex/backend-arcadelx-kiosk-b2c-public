import { Router } from 'express';
import { requireAuth, loadMembership, requireOrgType, requireRole } from '../../middlewares/auth';
import {
  getIpSettlements,
  getIpSettlementById,
  downloadIpSettlementPdf,
  getCompanyIpSettlements,
  triggerMonthlySettlementsEndpoint,
} from '../controllers/IpSettlementController';

const router = Router();

// IP Party Dashboard Settlements Tab
router.get('/', requireAuth, loadMembership, requireOrgType('IP_PARTY'), getIpSettlements);
router.get('/:id', requireAuth, loadMembership, requireOrgType('IP_PARTY'), getIpSettlementById);
router.get('/:id/download', requireAuth, loadMembership, requireOrgType('IP_PARTY'), downloadIpSettlementPdf);

// Company Dashboard IP Settlements Tab & Triggers
router.get('/company/:ipOrgId', requireAuth, loadMembership, requireOrgType('COMPANY'), requireRole('OWNER', 'ADMIN', 'MANAGER'), getCompanyIpSettlements);

//CRITICAL: FOR TESTING ONLY!!!!
router.post('/trigger', requireAuth, loadMembership, requireOrgType('COMPANY'), requireRole('OWNER', 'ADMIN'), triggerMonthlySettlementsEndpoint);

export default router;
