import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../utils/db";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { generateTemporaryPassword } from "../utils/temporary-password";
import { ApiError } from "../utils/ApiError";
import { getUserOrganizationAccess, assertOrganizationActive } from "../services/organization-access";
import { memberInviteRole } from '../services/member-invite';
import {
  RegisterOrgSchema,
  JoinOrgSchema,
  LoginSchema,
  ResetPasswordSchema,
  ForgotPasswordSchema,
  VerifyResetOtpSchema,
  CompletePasswordResetSchema,
} from "@shared-types/validationSchemas/auth.validation"; // Adjust import based on your monorepo setup
import { generateTokens, hashToken, setTokenCookies, clearTokenCookies } from "../utils/token";
import {
  queueCredentials,
  attemptDelivery,
  credentialDeliveryKey,
  retryOwnedDelivery,
} from "../services/email/delivery.service";
import {
  sendPasswordResetOtpEmail,
  sendPasswordChangedEmail,
} from "../services/email/passwordreset.email";
import {
  generateOtp,
  generateResetToken,
  hashResetValue,
} from "../utils/passwordReset";

/*
On the Frontend side  we only give 3 options
1.RegisterOrg
2.JoinOrg
3.Login 

On selecitng 1 or 2 , Users are registered first and then after that they are taken to the respective work they opt for*/

export const registerOrganization = asyncHandler(
  async (req: Request, res: Response) => {
    const validatedData = RegisterOrgSchema.parse(req.body);

    const parentOrgType = req.membership!.type;

    // Validate what this parent can create

    if (
      parentOrgType === "COMPANY" &&
      !["DISTRIBUTOR", "PARTNER"].includes(validatedData.orgType)
    )
      throw new ApiError(
        403,
        "A company can only create Distributor or Partner organizations",
      );

    if (
      parentOrgType === "DISTRIBUTOR" &&
      validatedData.orgType !== "PARTNER"
    ) {
      throw new ApiError(
        403,
        "A Distributor can only create Partner organizations",
      );
    }

    if (parentOrgType === "PARTNER")
      throw new ApiError(403, "A Partner cannot create organizations");

    const existingUser = await prisma.user.findUnique({
      where: {
        email: validatedData.ownerEmail,
      },
    });

    if (existingUser)
      throw new ApiError(409, "User with this email already exists");

    const existingContact = await prisma.user.findUnique({
      where: { contact: validatedData.ownerContact },
      select: { id: true },
    }).catch((error: unknown) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2022') {
        throw new ApiError(503, 'Owner contact registration is unavailable until the database migration is applied.');
      }
      throw error;
    });
    if (existingContact) throw new ApiError(409, 'User with this contact number already exists');

    // Generate temporary password

    const temporaryPassword = generateTemporaryPassword();

    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    // Create owner + organization + membership

    const { user, org } = await prisma.$transaction(async (tx) => {
      if (validatedData.orgType === "DISTRIBUTOR") {
        if (memberInviteRole(validatedData.inviteCode)) {
          throw new ApiError(400, 'Use a Distributor invitation, not an internal member invitation');
        }
        // Validate and consume the existing Company invite atomically. A failed
        // creation rolls this back; concurrent requests cannot reuse the code.
        const invite = await tx.organization.updateMany({
          where: {
            id: req.membership!.organizationId,
            type: "COMPANY",
            inviteCode: validatedData.inviteCode,
            OR: [
              { inviteCodeExpiresAt: null },
              { inviteCodeExpiresAt: { gt: new Date() } },
            ],
          },
          data: { inviteCode: null, inviteCodeExpiresAt: null },
        });
        if (invite.count !== 1) {
          throw new ApiError(
            400,
            "Invalid, expired, or already-used invite code for your Company",
          );
        }
      }

      const newUser = await tx.user.create({
        data: {
          name: validatedData.ownerName,
          email: validatedData.ownerEmail,
          contact: validatedData.ownerContact,
          passwordHash,
        },
      });

      const newOrg = await tx.organization.create({
        data: {
          name: validatedData.orgName,
          type: validatedData.orgType,
          // Preserve the registration hierarchy. Network connections and agreements
          // still govern collaboration, but the parent is visible immediately.
          parentOrgId: req.membership!.organizationId,
          state: validatedData.state,
          city: validatedData.city,
          pincode: validatedData.pincode,
          address: validatedData.address,
          gstNumber: validatedData.gstNumber ?? null,
          phone: validatedData.phone ?? null,
          country: validatedData.country ?? null,
          ownerId: newUser.id,
        },
      });

      await tx.membership.create({
        data: {
          userId: newUser.id,
          organizationId: newOrg.id,
          role: "OWNER",
          status: "ACTIVE",
        },
      });

      await queueCredentials(tx, req.membership!.organizationId, newOrg.id, {
        email: newUser.email,
        name: newUser.name,
        organizationName: newOrg.name,
        organizationType: newOrg.type,
        temporaryPassword,
      });
      return {
        user: newUser,
        org: newOrg,
      };
    });

    // Send credentials by email
    const credentialsEmailSent = await attemptDelivery(
      credentialDeliveryKey(org.id),
    );

    // IMPORTANT:
    // Do NOT generate access/refresh tokens here.
    // The parent organization user is already logged in.

    // Don't send the temporary password in the API response ,password should go through email service.
    res.status(201).json(
      new ApiResponse(
        201,
        {
          credentialsEmailSent,
          organization: {
            id: org.id,
            name: org.name,
            type: org.type,
          },
          owner: {
            id: user.id,
            name: user.name,
            email: user.email,
            contact: validatedData.ownerContact,
          },
        },
        "Organization created successfully",
      ),
    );
  },
);

//Join Organization(COMPAnY ONLY)
export const joinOrganization = asyncHandler(
  async (req: Request, res: Response) => {
    const validatedData = JoinOrgSchema.parse(req.body);

    const exsitingUser = await prisma.user.findUnique({
      where: { email: validatedData.email },
    });

    if (exsitingUser)
      throw new ApiError(409, "User with this email already exists ");

    const org = await prisma.organization.findUnique({
      where: { inviteCode: validatedData.inviteCode },
      select: { id: true, type: true, inviteCodeExpiresAt: true },
    });

    if (!org) throw new ApiError(404, "Invalid invite code");
    if (org.type !== "COMPANY")
      throw new ApiError(
        403,
        "Only Company organizations accept join requests",
      );

    if (org.inviteCodeExpiresAt && org.inviteCodeExpiresAt < new Date())
      throw new ApiError(400, "Invite code has expired");

    //Hash the password entered by the user
    const passwordHash = await bcrypt.hash(validatedData.password, 10);

    const user = await prisma.$transaction(async (tx) => {
      // Serialize with generation/consumption, then recheck after waiting for the lock.
      await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${org.id} FOR UPDATE`;
      const current = await tx.organization.findUnique({
        where: { id: org.id },
        select: { inviteCode: true, inviteCodeExpiresAt: true, type: true },
      });
      if (!current || current.type !== 'COMPANY' || current.inviteCode !== validatedData.inviteCode ||
          (current.inviteCodeExpiresAt && current.inviteCodeExpiresAt <= new Date())) {
        throw new ApiError(400, 'Invite code is expired, replaced, or already used');
      }
      const role = memberInviteRole(current.inviteCode);
      const newUser = await tx.user.create({
        data: {
          name: validatedData.name,
          email: validatedData.email,
          passwordHash,
        },
      });

      await tx.membership.create({
        data: { userId: newUser.id, organizationId: org.id, status: role ? "ACTIVE" : "PENDING", role },
      });

      if (role) {
        await tx.organization.update({
          where: { id: org.id },
          data: { inviteCode: null, inviteCodeExpiresAt: null },
          select: { id: true },
        });
      }

      return newUser;
    });
    const { accessToken, refreshToken } = generateTokens(user.id);

    await prisma.refreshToken.create({
      data: {
        token: hashToken(refreshToken),
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    setTokenCookies(res, accessToken, refreshToken);

    res
      .status(201)
      .json(
        new ApiResponse(
          201,
          { user: { id: user.id, email: user.email }, membership: {
            organizationId: org.id,
            role: memberInviteRole(validatedData.inviteCode),
            status: memberInviteRole(validatedData.inviteCode) ? 'ACTIVE' : 'PENDING',
          } },
          memberInviteRole(validatedData.inviteCode) ? "Account created. Company dashboard access enabled." : "Successfully joined organization. Pending approval.",
        ),
      );
  },
);

//After every login we are rotating the refresh tokens
export const retryOrganizationCredentials = asyncHandler(async (req, res) => {
  const id = req.params.organizationId;
  if (typeof id !== "string")
    throw new ApiError(400, "Invalid organization ID");
  const credentialsEmailSent = await retryOwnedDelivery(
    credentialDeliveryKey(id),
    req.membership!.organizationId,
  );
  res
    .status(credentialsEmailSent ? 200 : 202)
    .json(
      new ApiResponse(
        credentialsEmailSent ? 200 : 202,
        { credentialsEmailSent },
        credentialsEmailSent
          ? "Credentials delivered"
          : "Credentials remain queued; retry later",
      ),
    );
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = LoginSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new ApiError(401, "Invalid email or password");

  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  if (!isPasswordValid) throw new ApiError(401, "Invalid email or password");

  const { accessToken, refreshToken } = await prisma.$transaction(async (tx) => {
    // Serialize session creation with Company activation/deactivation.
    const access = await getUserOrganizationAccess(user.id, tx, true);
    assertOrganizationActive(access);
    const tokens = generateTokens(user.id, access?.accessVersion ?? 0);
    await tx.refreshToken.create({
      data: {
        token: hashToken(tokens.refreshToken),
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    return tokens;
  });

  setTokenCookies(res, accessToken, refreshToken);

  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { user: { id: user.id, email: user.email } },
        "Login successful",
      ),
    );
});

// No access-token or membership gate: expired sessions must also be able to exit.
export const logout = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.cookies.refresh_token;
  if (typeof refreshToken === "string" && refreshToken) {
    await prisma.refreshToken.deleteMany({ where: { token: hashToken(refreshToken) } });
  }
  clearTokenCookies(res);
  res.status(200).json(new ApiResponse(200, null, "Signed out successfully"));
});

//Refresh Endpoint
export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.cookies.refresh_token;

  if (!refreshToken) throw new ApiError(401, "Refresh token missing");

  const hashedToken = hashToken(refreshToken);

  const storedToken = await prisma.refreshToken.findUnique({
    where: {
      token: hashedToken,
    },
  });

  if (!storedToken || storedToken.revoked) throw new ApiError(401, "Invalid refresh token");

  if (storedToken.expiresAt < new Date()) {
    // Clean up expired token
    await prisma.refreshToken.delete({
      where: {
        id: storedToken.id,
      },
    });

    throw new ApiError(401, "Refresh token expired, Please Login Again");
  }

  // Recheck after taking the organization lock: deactivation may have revoked
  // the token while this request was waiting. It must never mint a new session.
  const { accessToken, refreshToken: newRefreshToken } = await prisma.$transaction(async (tx) => {
    const access = await getUserOrganizationAccess(storedToken.userId, tx, true);
    assertOrganizationActive(access);
    const consumed = await tx.refreshToken.deleteMany({
      where: { id: storedToken.id, revoked: false, expiresAt: { gt: new Date() } },
    });
    if (consumed.count !== 1) throw new ApiError(401, "Invalid refresh token");
    const tokens = generateTokens(storedToken.userId, access?.accessVersion ?? 0);

    // Store new refresh token
    await tx.refreshToken.create({
      data: {
        token: hashToken(tokens.refreshToken),
        userId: storedToken.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    return tokens;
  });

  // Send new tokens
  setTokenCookies(res, accessToken, newRefreshToken);

  res
    .status(200)
    .json(
      new ApiResponse(200, { accessToken }, "Token refreshed successfully"),
    );
});

//Routes for frontend...
export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: {
      id: req.user!.id,
    },
    select: {
      id: true,
      email: true,
      name: true,
      membership: {
        select: {
          organizationId: true,
          status: true,
          role: true,
          organization: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
        },
      },
    },
  });
  if (!user) throw new ApiError(404, "User not found");

  res
    .status(200)
    .json(new ApiResponse(200, { user }, "User fetched successfully"));
});

export const changePassword = asyncHandler(
  async (req: Request, res: Response) => {
    const { email, currentPassword, newPassword } = ResetPasswordSchema.parse(
      req.body,
    );

    const user = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (!user) {
      throw new ApiError(401, "Invalid email or current password");
    }

    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new ApiError(401, "Invalid email or current password");
    }

    // Prevent using the same password again
    const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);

    if (isSamePassword) {
      throw new ApiError(
        400,
        "New password must be different from your current password",
      );
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    await prisma.$transaction(async (tx) => {
      // Update password
      await tx.user.update({
        where: {
          id: user.id,
        },
        data: {
          passwordHash: newPasswordHash,
        },
      });

      // Invalidate existing refresh tokens
      await tx.refreshToken.deleteMany({
        where: {
          userId: user.id,
        },
      });
    });

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          null,
          "Password reset successfully. Please login again.",
        ),
      );
  },
);

export const forgotPassword = asyncHandler(
  async (req: Request, res: Response) => {
    const { email } = ForgotPasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    /*IMPORTANT:Don't reveal whether the email exists. */

    if (!user)
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            null,
            "If an account exists with this email, an OTP has been sent.",
          ),
        );

    const otp = generateOtp();
    const otpHash = hashResetValue(otp);

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    /* Invalidate previous password reset requests.*/
    await prisma.passwordReset.updateMany({
      where: {
        userId: user.id,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    });

    /* Create new reset request.*/
    await prisma.passwordReset.create({
      data: {
        userId: user.id,
        otpHash,
        expiresAt,
      },
    });

    /* Send OTP.*/
    await sendPasswordResetOtpEmail({
      email: user.email,
      name: user.name,
      otp,
    });

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          null,
          "If an account exists with this email, an OTP has been sent.",
        ),
      );
  },
);

export const verifyResetOtp = asyncHandler(
  async (req: Request, res: Response) => {
    const { email, otp } = VerifyResetOtpSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    /* Don't reveal whether the email exists.*/
    if (!user) throw new ApiError(400, "Invalid or expired OTP");

    const resetRequest = await prisma.passwordReset.findFirst({
      where: {
        userId: user.id,
        usedAt: null,
        verifiedAt: null,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!resetRequest) throw new ApiError(400, "Invalid or expired OTP");

    /* Check expiration.*/
    if (resetRequest.expiresAt < new Date()) {
      await prisma.passwordReset.update({
        where: {
          id: resetRequest.id,
        },
        data: {
          usedAt: new Date(),
        },
      });

      throw new ApiError(400, "OTP has expired");
    }

    /* Prevent brute-force attempts.*/
    if (resetRequest.attempts >= 5) {
      await prisma.passwordReset.update({
        where: {
          id: resetRequest.id,
        },
        data: {
          usedAt: new Date(),
        },
      });

      throw new ApiError(
        429,
        "Too many incorrect attempts. Please request a new OTP.",
      );
    }

    /*Hash the OTP entered by the user.*/
    const submittedOtpHash = hashResetValue(otp);

    /*Compare hashes.*/
    if (submittedOtpHash !== resetRequest.otpHash) {
      await prisma.passwordReset.update({
        where: {
          id: resetRequest.id,
        },
        data: {
          attempts: {
            increment: 1,
          },
        },
      });

      throw new ApiError(400, "OTP is incorrect");
    }

    /*
     * OTP is correct.
     */

    const resetToken = generateResetToken();
    const resetTokenHash = hashResetValue(resetToken);

    await prisma.passwordReset.update({
      where: {
        id: resetRequest.id,
      },
      data: {
        verifiedAt: new Date(),
        resetToken: resetTokenHash,
      },
    });

    res.status(200).json(
      new ApiResponse(
        200,
        {
          resetToken,
        },
        "OTP verified successfully",
      ),
    );
  },
);

export const completeForgotPassword = asyncHandler(
  async (req: Request, res: Response) => {
    const { resetToken, newPassword } = CompletePasswordResetSchema.parse(
      req.body,
    );

    // Hash the incoming reset token to compare with the database record
    const hashedResetToken = hashResetValue(resetToken);

    // Find the valid password reset request using the token
    const resetRequest = await prisma.passwordReset.findFirst({
      where: {
        resetToken: hashedResetToken,
        usedAt: null,
        verifiedAt: { not: null }, // Must have successfully verified OTP already
      },
    });

    if (!resetRequest) {
      throw new ApiError(400, "Invalid or expired reset token");
    }

    // Check if the token has expired (e.g., giving them a 15-min window after OTP verification)
    if (resetRequest.expiresAt < new Date()) {
      await prisma.passwordReset.update({
        where: { id: resetRequest.id },
        data: { usedAt: new Date() },
      });
      throw new ApiError(
        400,
        "Reset token has expired. Please request a new OTP.",
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: resetRequest.userId },
    });

    if (!user) {
      throw new ApiError(404, "User not found");
    }

    // Prevent using the same password again
    const isSamePassword = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSamePassword) {
      throw new ApiError(
        400,
        "New password must be different from your current password",
      );
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Perform atomic update: update password, mark reset request as used, and clear active sessions
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: newPasswordHash },
      });

      await tx.passwordReset.update({
        where: { id: resetRequest.id },
        data: { usedAt: new Date() },
      });

      // Invalidate all existing refresh tokens for security
      await tx.refreshToken.deleteMany({
        where: { userId: user.id },
      });
    });

    await sendPasswordChangedEmail({
      email: user.email,
      name: user.name,
    });

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          null,
          "Password has been reset successfully. Please log in with your new password.",
        ),
      );
  },
);
