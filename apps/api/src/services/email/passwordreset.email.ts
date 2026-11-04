import { sendEmail } from "./email.service";
import {
  emailCallout,
  emailCredential,
  emailParagraph,
  emailShell,
} from "./email-theme";

type PasswordResetEmailParams = {
  email: string;
  name: string;
  otp: string;
};

export const sendPasswordResetOtpEmail = async ({
  email,
  name,
  otp,
}: PasswordResetEmailParams) => {
  await sendEmail({
    to: email,
    toName: name,

    subject: "ARCADELX – Your password reset OTP",

    text: `
Hello ${name},

We received a request to reset your password.

Your one-time code is:

${otp}

This code will expire in 10 minutes. If you did not request it, you can ignore this email.

Regards,
${process.env.MAIL_FROM_NAME}
`,

    html: emailShell({
      preheader: `Your password reset code expires in 10 minutes`,
      heading: "Reset your password",
      subtitle: "We received a request to reset your password.",
      content: [
        emailParagraph(`Hello ${name}, enter this one-time code to continue.`),
        // Monospace with wide tracking: the credential style also fixes the ambiguous
        // l/I/1 glyph problem that plain sans-serif caused on emailed passwords.
        emailCredential(otp),
        emailParagraph("This code expires in <strong>10 minutes</strong>."),
        emailCallout(
          "If you did not request a password reset, ignore this email and consider changing your password from Settings.",
        ),
      ].join(""),
    }),
  });
};

type PasswordChangedEmailParams = {
  email: string;
  name: string;
};

export const sendPasswordChangedEmail = async ({
  email,
  name,
}: PasswordChangedEmailParams) => {
  await sendEmail({
    to: email,
    toName: name,
    subject: "Your password has been changed",
    text: `
Hello ${name},

This is a confirmation that the password for your account has been successfully changed.

If you did not make this change, please contact support immediately.

Regards,
${process.env.MAIL_FROM_NAME}
`,
    html: emailShell({
      preheader: "Your password was changed",
      heading: "Password changed",
      subtitle: "Your account password was updated successfully.",
      content: [
        emailParagraph(`Hello ${name}, this confirms the password on your account was changed.`),
        emailCallout(
          "If you did not make this change, contact the ARCADELX support team immediately to secure your account.",
          "destructive",
        ),
      ].join(""),
    }),
  });
};
