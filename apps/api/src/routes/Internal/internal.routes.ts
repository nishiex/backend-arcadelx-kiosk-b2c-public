import { Router } from 'express';
import { getUnpairedKiosks, pairKioskDevice,UnpairKioskDevice } from '../../controllers/Internal/internal.controller';
import { getKioskAdManifest, streamKioskAdVideo } from '../../controllers/Internal/kiosk-ads.controller';
import { requireInternalAuth } from '../../middlewares/internal.auth';

const router = Router();

// The inventory lookup is intentionally public for the current integration test.
// Pairing remains server-to-server protected because it changes hardware ownership.
router.get('/kiosks/unpaired', getUnpairedKiosks);
router.post('/kiosks/:machineCode/pair', requireInternalAuth, pairKioskDevice);
// Unpairing releases hardware just like pairing claims it, so it carries the same
// server-to-server guard; the kiosk broker holds the secret, browsers never do.
router.post('/kiosks/:machineCode/:hardwareUUID/unpair', requireInternalAuth, UnpairKioskDevice)

// Ad delivery for the hardware. Assigning an ad in the console only writes a row, so the
// cabinet polls this manifest and then downloads the files it lists. Both routes carry the
// same server-to-server guard as pairing, because a kiosk has no user session; the file
// route re-checks the assignment so an unassigned ad stops being downloadable immediately.
router.get('/kiosks/:machineCode/ads', requireInternalAuth, getKioskAdManifest);
router.get('/ads/files/:filename', requireInternalAuth, streamKioskAdVideo);

export default router;
