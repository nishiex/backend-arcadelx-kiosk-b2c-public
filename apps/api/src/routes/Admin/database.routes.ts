import { Router } from 'express';
import { wipeLiveDatabase } from '../../controllers/Admin/database.controller';
import { loadMembership, requireAuth, requireOrgType, requireRole } from '../../middlewares/auth';

const router = Router();

router.use(requireAuth, loadMembership, requireOrgType('COMPANY'), requireRole('OWNER'));
router.post('/wipe', wipeLiveDatabase);

export default router;
