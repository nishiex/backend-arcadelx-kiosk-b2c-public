import crypto from "crypto";

export const generateOtp = (): string => {
  return crypto.randomInt(100000, 1000000).toString();
};

export const generateResetToken = (): string => {
  return crypto.randomBytes(32).toString("hex");
};

export const hashResetValue = (value: string): string => {
  return crypto.createHash("sha256").update(value).digest("hex");
};
