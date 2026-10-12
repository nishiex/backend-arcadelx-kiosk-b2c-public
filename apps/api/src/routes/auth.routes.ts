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
import { authRateLimiter } from "../middlewares/Rate-Limiter/rateLimiter";

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

router.post("/login", authRateLimiter, login);

router.post("/refresh", refresh);
// Existing refresh cookies are scoped here, so this path receives them too.
router.post("/refresh/logout", logout);

router.get("/me", requireAuth, getMe);

router.post("/change-password", requireAuth, changePassword);

// Unauthenticated credential-recovery endpoints: throttled because they are
// guessable and, before this, had no limit at all.
router.post("/forgot-password", authRateLimiter, forgotPassword);
router.post("/verify-reset-otp", authRateLimiter, verifyResetOtp);
router.post("/reset-password", authRateLimiter, completeForgotPassword);

export default router;
