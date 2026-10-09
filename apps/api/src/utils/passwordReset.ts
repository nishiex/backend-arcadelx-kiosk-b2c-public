import crypto from "crypto";

// Digits 0 and 1 are excluded: they are misread as O and l/I when transcribed by hand.
const OTP_DIGITS = "23456789";
const OTP_LENGTH = 6;

export const generateOtp = (): string => {
  let code = "";
  for (let index = 0; index < OTP_LENGTH; index += 1) {
    code += OTP_DIGITS[crypto.randomInt(OTP_DIGITS.length)];
  }
  return code;
};

export const generateResetToken = (): string => {
  return crypto.randomBytes(32).toString("hex");
};

export const hashResetValue = (value: string): string => {
  return crypto.createHash("sha256").update(value).digest("hex");
};
