import { Router } from "express";
import {
  registerOrganization,
  joinOrganization,
  login,
  logout,
  refresh,
  getMe,
  changePassword,
  forgotPassword,
  verifyResetOtp,
  completeForgotPassword,
  retryOrganizationCredentials,
} from "../controllers/auth.controller";
import {
  requireAuth,
  loadMembership,
  requireCanCreateOrganization,
  requireRole,
} from "../middlewares/auth";

const router = Router();
router.post(
  "/register",
  requireAuth,
  loadMembership,
  requireCanCreateOrganization,
  requireRole("OWNER", "ADMIN"),
  registerOrganization,
);
router.post(
  "/organizations/:organizationId/credentials/retry",
  requireAuth,
  loadMembership,
  requireCanCreateOrganization,
  requireRole("OWNER", "ADMIN"),
  retryOrganizationCredentials,
);

router.post("/join", joinOrganization);

router.post("/login", login);

router.post("/refresh", refresh);
// Existing refresh cookies are scoped here, so this path receives them too.
router.post("/refresh/logout", logout);

router.get("/me", requireAuth, getMe);

router.post("/change-password", requireAuth, changePassword);

router.post("/forgot-password", forgotPassword);
router.post("/verify-reset-otp", verifyResetOtp);
router.post("/reset-password", completeForgotPassword);

export default router;
