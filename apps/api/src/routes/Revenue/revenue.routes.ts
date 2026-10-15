import { Router } from 'express';
import { requireAuth, loadMembership,requireOrgType,requireRole } from "../../middlewares/auth";
import { getMachineWiseRevenue,getSystemSettings,updateSystemSettings,getRevenueSeries,getMothershipPaymentsFeed,syncMothershipPayments } from "../../controllers/Revenue/revenue.controller";

const router = Router();

router.use(requireAuth, loadMembership);

// Route for Machine-Wise Revenue Data Table
router.get("/machine-wise",requireOrgType("COMPANY","DISTRIBUTOR","PARTNER") ,requireRole("OWNER","ADMIN","MANAGER") ,getMachineWiseRevenue);

// Revenue trend for the dashboard chart. Same guards and scoping as machine-wise.
router.get("/series",requireOrgType("COMPANY","DISTRIBUTOR","PARTNER") ,requireRole("OWNER","ADMIN","MANAGER") ,getRevenueSeries);

// The upstream feed contains the full fleet's payment records. Only Company
// Owners/Admins may read it; no import or write to the local ledger is performed.
router.get("/payments", requireOrgType("COMPANY"), requireRole("OWNER", "ADMIN"), getMothershipPaymentsFeed);
router.post("/payments/sync", requireOrgType("COMPANY"), requireRole("OWNER", "ADMIN"), syncMothershipPayments);

// Anyone can view the settings (needed for frontend calculators)
router.get("/deduction-rates", getSystemSettings);

// Only COMPANY Owners/Admins can edit the tax and fee rates
router.patch("/deduction-rates", requireOrgType("COMPANY"), requireRole("OWNER", "ADMIN"), updateSystemSettings);

export default router;
