import { z } from "zod";

/**
 * Reusable field schemas
 */

const nameSchema = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(100, "Name must not exceed 100 characters");

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Please enter a valid email address")
  .max(254, "Email address is too long");

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must not exceed 128 characters");

const addressSchema = z
  .string()
  .trim()
  .min(5, "Address must be at least 5 characters")
  .max(300, "Address must not exceed 300 characters");

const citySchema = z
  .string()
  .trim()
  .min(2, "City must be at least 2 characters")
  .max(100, "City must not exceed 100 characters");

const stateSchema = z
  .string()
  .trim()
  .min(2, "State must be at least 2 characters")
  .max(100, "State must not exceed 100 characters");

const pincodeSchema = z
  .number()
  .int("Pincode must be a whole number")
  .min(100000, "Invalid pincode")
  .max(999999, "Invalid pincode");

/**
 * Register Organization
 */

const RegisterOrgFields = z.object({
  orgName: nameSchema,
  ownerName: nameSchema,
  ownerEmail: emailSchema,
  ownerContact: z.string().trim().regex(/^\d{10}$/, "Owner contact must be a 10-digit number"),
  state: stateSchema,
  city: citySchema,
  pincode: pincodeSchema,
  address: addressSchema,
  gstNumber: z.string().trim().min(1).max(30).optional(),
  phone: z.string().trim().min(1).max(32).optional(),
  country: z.string().trim().min(1).max(100).optional(),
});

export const RegisterOrgSchema = z.discriminatedUnion("orgType", [
  RegisterOrgFields.extend({
    orgType: z.literal("DISTRIBUTOR"),
    inviteCode: z
      .string({ error: "Invite code is required" })
      .trim()
      .min(1, "Invite code is required")
      .max(10, "Invalid invite code"),
  }),
  RegisterOrgFields.extend({ orgType: z.literal("PARTNER") }),
]);

export type RegisterOrgInput = z.infer<typeof RegisterOrgSchema>;

/**
 * Login
 */

export const LoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

/**
 * Join Organization
 */

export const JoinOrgSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  inviteCode: z.string().trim().min(1, "Invite code is required").max(10, "Invalid invite code"),
});

export const ResetPasswordSchema = z
  .object({
    email: z.string().email(),
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "New passwords do not match",
    path: ["confirmPassword"],
  });

export const ForgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export const VerifyResetOtpSchema = z.object({
  email: z.string().email("Invalid email address"),

  otp: z
    .string()
    .length(6, "OTP must be 6 digits")
    .regex(/^\d{6}$/, "OTP must contain only numbers"),
});

export const CompletePasswordResetSchema = z
  .object({
    resetToken: z.string().min(1, "Reset token is required"),

    newPassword: passwordSchema,
    confirmPassword: passwordSchema,
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
