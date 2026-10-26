import { Router } from "express";
import { requireAuth, loadMembership, requireOrgType, requireRole } from "../../middlewares/auth";
import { getAnalyticsSummary } from "../../controllers/Analytics/analytics.controller";

const router = Router();

router.use(requireAuth, loadMembership);
router.get("/summary", requireOrgType("COMPANY", "DISTRIBUTOR"), requireRole("OWNER", "ADMIN"), getAnalyticsSummary);

export default router;
