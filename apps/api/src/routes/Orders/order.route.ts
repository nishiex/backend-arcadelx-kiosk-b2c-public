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
  getOrderInvoice,
  getOrderRequests,
  getOrderDetails,
  markOrderAsPaid,
  dispatchOrder,
  deliverOrder,
  retryOrderInvoice,
  getRequestModelAvailability,
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

//Only Company can approve order request as only that org type can recuive Order requests , Not the distributor
router.patch(
  "/:orderId/approve",
  requireOrgType("COMPANY", "DISTRIBUTOR"),
  requireRole("OWNER", "ADMIN"),
  approveOrder,
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

//pdf route for the frontend
router.get("/:orderId/invoice", getOrderInvoice);
router.post(
  "/:orderId/invoice/retry",
  requireOrgType("COMPANY", "DISTRIBUTOR"),
  requireRole("OWNER", "ADMIN"),
  retryOrderInvoice,
);

export default router;

//TODO:implement requirerole in get routes
