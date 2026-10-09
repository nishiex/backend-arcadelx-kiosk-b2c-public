import { Router } from 'express';
import { requireAuth, loadMembership,requireOrgType,requireRole } from "../../middlewares/auth";
import { getMachineWiseRevenue,getSystemSettings,updateSystemSettings,getRevenueSeries } from "../../controllers/Revenue/revenue.controller";

const router = Router();

router.use(requireAuth, loadMembership);

// Route for Machine-Wise Revenue Data Table
router.get("/machine-wise",requireOrgType("COMPANY","DISTRIBUTOR","PARTNER") ,requireRole("OWNER","ADMIN","MANAGER") ,getMachineWiseRevenue);

// Revenue trend for the dashboard chart. Same guards and scoping as machine-wise.
router.get("/series",requireOrgType("COMPANY","DISTRIBUTOR","PARTNER") ,requireRole("OWNER","ADMIN","MANAGER") ,getRevenueSeries);

// Anyone can view the settings (needed for frontend calculators)
router.get("/deduction-rates", getSystemSettings);

// Only COMPANY Owners/Admins can edit the tax and fee rates
router.patch("/deduction-rates", requireOrgType("COMPANY"), requireRole("OWNER", "ADMIN"), updateSystemSettings);

export default router;
