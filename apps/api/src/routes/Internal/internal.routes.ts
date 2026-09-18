import { Router } from 'express';
import { getUnpairedKiosks, pairKioskDevice } from '../../controllers/Internal/internal.controller';
import { requireInternalAuth } from '../../middlewares/internal.auth';

const router = Router();

// Apply the constant-time secret key verification to all Mothership routes
router.use(requireInternalAuth);

router.get('/kiosks/unpaired', getUnpairedKiosks);
router.post('/kiosks/:machineCode/pair', pairKioskDevice);

export default router;