import type { Request, Response } from "express";
import { ApiError } from "../utils/ApiError";
import { ApiResponse } from "../utils/ApiResponse";
import { asyncHandler } from "../utils/asyncHandler";
import { prisma } from "../utils/db";
import { generateOtp, hashResetValue } from "../utils/passwordReset";
import { sendWhatsappOtp } from "../services/whatsapp/whatsapp-otp.service";
import {
  SendPhoneOtpSchema,
  VerifyPhoneOtpSchema,
} from "@shared-types/validationSchemas/auth.validation";

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const normalizePhone = (phone: string): string => {
  if (phone.startsWith("+")) return phone;
  return `+91${phone}`;
};

export const sendPhoneOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone: rawPhone } = SendPhoneOtpSchema.parse(req.body);
  const phone = normalizePhone(rawPhone);
  const otp = generateOtp();
  await prisma.phoneVerification.updateMany({
    where: { phone, verifiedAt: null },
    data: { expiresAt: new Date() },
  });
  const verification = await prisma.phoneVerification.create({
    data: {
      phone,
      otpHash: hashResetValue(otp),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  try {
    await sendWhatsappOtp({ phone, otp });
  } catch {
    await prisma.phoneVerification.delete({ where: { id: verification.id } });
    throw new ApiError(503, "WhatsApp OTP delivery is not configured or unavailable");
  }

  res.status(200).json(
    new ApiResponse(200, { verificationId: verification.id }, "WhatsApp OTP sent"),
  );
});

export const verifyPhoneOtp = asyncHandler(async (req: Request, res: Response) => {
  const { phone: rawPhone, otp } = VerifyPhoneOtpSchema.parse(req.body);
  const phone = normalizePhone(rawPhone);
  const verification = await prisma.phoneVerification.findFirst({
    where: { phone, verifiedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "desc" },
  });

  if (!verification) throw new ApiError(400, "Invalid or expired OTP");

  const matches = hashResetValue(otp) === verification.otpHash;
  if (!matches) {
    await prisma.phoneVerification.update({
      where: { id: verification.id },
      data: { attempts: { increment: 1 } },
    });
    throw new ApiError(400, "Invalid or expired OTP");
  }

  const verifiedAt = new Date();
  await prisma.phoneVerification.update({
    where: { id: verification.id },
    data: { verifiedAt },
  });

  res.status(200).json(
    new ApiResponse(200, { phone, verifiedAt }, "Phone number verified"),
  );
});
