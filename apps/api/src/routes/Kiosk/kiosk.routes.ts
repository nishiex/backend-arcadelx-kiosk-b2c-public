import { Router } from "express";
import {batchCreateKiosks,getKiosks,getKioskById,deactivateKiosks,getInventorySummary,} from "../../controllers/Kiosk/kiosk.controller";
import {requireAuth,loadMembership,requireOrgType,requireRole,} from "../../middlewares/auth";

const router = Router();

router.use(requireAuth, loadMembership);

// Only the Company can mint new physical machine codes
router.post("/batch",requireOrgType("COMPANY"),requireRole("OWNER", "ADMIN"),batchCreateKiosks,);

/**
 * /kiosks : Own inventory
 * /kiosks?organizationId=PARTNER_ID
 */
router.get("/", getKiosks);
router.get("/summary", getInventorySummary); // Place before /:id so 'summary' isn't treated as an ID

router.post("/deactivate",requireOrgType("COMPANY", "DISTRIBUTOR"),requireRole("OWNER", "ADMIN"),deactivateKiosks,);

router.get("/:id", getKioskById);

export default router;
