import { Router } from 'express';
import { getUnpairedKiosks, pairKioskDevice,UnpairKioskDevice } from '../../controllers/Internal/internal.controller';
import { requireInternalAuth } from '../../middlewares/internal.auth';

const router = Router();

// The inventory lookup is intentionally public for the current integration test.
// Pairing remains server-to-server protected because it changes hardware ownership.
router.get('/kiosks/unpaired', getUnpairedKiosks);
router.post('/kiosks/:machineCode/pair', requireInternalAuth, pairKioskDevice);
// Unpairing releases hardware just like pairing claims it, so it carries the same
// server-to-server guard; the kiosk broker holds the secret, browsers never do.
router.post('/kiosks/:machineCode/:hardwareUUID/unpair', requireInternalAuth, UnpairKioskDevice)

export default router;
