import { Router } from 'express';
import { 
  batchCreateKiosks, 
  getKiosks, 
  getKioskById, 
  updateKioskStatus, 
  getInventorySummary 
} from '../../controllers/Kiosk/kiosk.controller';
import { requireAuth, loadMembership, requireOrgType } from '../../middlewares/auth';

const router = Router();

router.use(requireAuth, loadMembership);

// Only the Company can mint new physical machine codes
router.post('/batch', requireOrgType('COMPANY'), batchCreateKiosks);

router.get('/', getKiosks);
router.get('/summary', getInventorySummary); // Place before /:id so 'summary' isn't treated as an ID
router.get('/:id', getKioskById);
router.patch('/:id/status', requireOrgType("COMPANY","DISTRIBUTOR"),updateKioskStatus);

export default router;