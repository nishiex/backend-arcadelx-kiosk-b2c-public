import { Router } from "express";
import { requireAuth, loadMembership, requireOrgType, requireRole } from "../../middlewares/auth";
import { getMachineActivity } from "../../controllers/Reports/reports.controller";

const router = Router();

router.use(requireAuth, loadMembership);
router.get(
  "/machine-activity",
  requireOrgType("COMPANY", "DISTRIBUTOR", "PARTNER"),
  requireRole("OWNER", "ADMIN", "MANAGER", "STAFF"),
  getMachineActivity,
);

export default router;
