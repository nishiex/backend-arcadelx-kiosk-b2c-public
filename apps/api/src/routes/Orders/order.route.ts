import { Router } from "express";

import {
  requireAuth,
  loadMembership,
  requireOrgType,
  requireRole,
} from "../../middlewares/auth";
import {
  createOrder,
  approveOrder,
  rejectOrder,
  retryOrderInvoice,
  getOrderRequests,
  getOrderDetails,
  markOrderAsPaid,
  requestCashPayment,
  dispatchOrder,
  deliverOrder,
  getRequestModelAvailability,
  updateOrderPricing,
} from "../../controllers/Orders/orders.controller";

const router = Router();

router.use(requireAuth, loadMembership);

// Get orders / requests for current organization
router.get("/", getOrderRequests);
router.get(
  "/request-models",
  requireOrgType("DISTRIBUTOR", "PARTNER"),
  requireRole("OWNER", "ADMIN"),
  getRequestModelAvailability,
);
router.get("/:orderId", getOrderDetails);

//create Orders
router.post(
  "/create",
  requireOrgType("COMPANY", "DISTRIBUTOR", "PARTNER"),
  requireRole("OWNER", "ADMIN"),
  createOrder,
);

// Existing order pricing is editable only by the Company Master Admin (COMPANY OWNER).
router.patch(
  "/:orderId/pricing",
  requireOrgType("COMPANY"),
  requireRole("OWNER"),
  updateOrderPricing,
);

//Only Company can approve order request as only that org type can recuive Order requests , Not the distributor
router.patch(
  "/:orderId/approve",
  requireOrgType("COMPANY", "DISTRIBUTOR"),
  requireRole("OWNER", "ADMIN"),
  approveOrder,
);

router.post(
  "/:orderId/payment/cash-request",
  requireOrgType("DISTRIBUTOR", "PARTNER"),
  requireRole("OWNER", "ADMIN"),
  requestCashPayment,
);
router.patch('/:orderId/reject', requireOrgType('COMPANY', 'DISTRIBUTOR'), requireRole('OWNER', 'ADMIN'), rejectOrder);

//Mark Order as Paid
router.patch(
  "/:orderId/paid",
  requireOrgType("COMPANY", "DISTRIBUTOR"),
  requireRole("OWNER", "ADMIN"),
  markOrderAsPaid,
);

// Dispatch PAID order
router.patch(
  "/:orderId/dispatch",
  requireOrgType("COMPANY", "DISTRIBUTOR"),
  requireRole("OWNER", "ADMIN"),
  dispatchOrder,
);

// Deliver order / transfer kiosk ownership
router.patch(
  "/:orderId/deliver",
  requireOrgType("COMPANY", "DISTRIBUTOR"),
  requireRole("OWNER", "ADMIN"),
  deliverOrder,
);

router.post(
  "/:orderId/invoice/retry",
  requireOrgType("COMPANY", "DISTRIBUTOR"),
  requireRole("OWNER", "ADMIN"),
  retryOrderInvoice,
);

export default router;

//TODO:implement requirerole in get routes
