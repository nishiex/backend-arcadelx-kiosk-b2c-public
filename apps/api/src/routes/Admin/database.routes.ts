import { Router } from 'express';
import { wipeLocalDatabase } from '../../controllers/Admin/database.controller';
import { loadMembership, requireAuth, requireOrgType, requireRole } from '../../middlewares/auth';

const router = Router();

router.use(requireAuth, loadMembership, requireOrgType('COMPANY'), requireRole('OWNER'));
router.post('/wipe-local', wipeLocalDatabase);

export default router;
