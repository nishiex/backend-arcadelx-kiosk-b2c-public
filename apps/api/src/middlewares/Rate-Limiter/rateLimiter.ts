import rateLimit from "express-rate-limit";

/**
 * Throttles the unauthenticated credential endpoints (login, forgot-password,
 * verify-reset-otp, reset-password). Ported from the Backend branch, where these
 * routes had no limit at all: the only brute-force protection was the 5-attempt cap
 * on a single OTP record, which an attacker resets by requesting a new OTP.
 *
 * In-memory store, so the window is per process. A multi-instance deployment needs a
 * shared store; that is a deliberate follow-up, not a regression from today.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  // Isolated regression suites create more than ten synthetic users by design.
  // Keep the production limiter unchanged while allowing those suites to test
  // authorization and order behavior without waiting for the window to expire.
  skip: () => process.env.NODE_ENV === "test",
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    message: "Too many requests. Please try again later.",
  },
});
