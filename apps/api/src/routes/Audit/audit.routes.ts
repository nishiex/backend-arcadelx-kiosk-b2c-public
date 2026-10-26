import { Router } from "express";
import { getAuditLogs } from "../../controllers/Audit/audit.controller";
import { requireAuth, loadMembership, requireOrgType, requireRole } from "../../middlewares/auth";

const router = Router();
router.use(requireAuth, loadMembership, requireOrgType("COMPANY"), requireRole("OWNER", "ADMIN"));
router.get("/", getAuditLogs);
export default router;
