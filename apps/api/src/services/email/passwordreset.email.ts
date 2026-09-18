import { sendEmail } from "./email.service";

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

Your OTP is:

${otp}

This OTP will expire in 10 minutes.

Regards,
${process.env.MAIL_FROM_NAME}
`,

    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #222;">

        <h2>Password Reset</h2>

        <p>Hello ${name},</p>

        <p>
          We received a request to reset your password.
        </p>

        <p>Your verification code is:</p>

        <div
          style="
            font-size: 32px;
            font-weight: bold;
            letter-spacing: 8px;
            padding: 16px;
            background: #f3f4f6;
            width: fit-content;
            border-radius: 8px;
          "
        >
          ${otp}
        </div>

        <p>
          This OTP will expire in <strong>10 minutes</strong>.
        </p>

        <p>
          Regards,<br />
          ${process.env.MAIL_FROM_NAME}
        </p>

      </div>
    `,
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
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #222;">
        <h2>Password Changed Successfully</h2>
        <p>Hello ${name},</p>
        <p>This is a confirmation that the password for your account has been successfully changed.</p>
        <p style="color: #d9534f; font-weight: bold;">
          If you did not initiate this password change, please contact the ARCADELX Support Team immediately to secure your account
        </p>
        <p>
          Regards,<br />
          TEAM ${process.env.MAIL_FROM_NAME}
          Nilee Games and Future Technologies Pvt. Ltd.
        </p>
      </div>
    `,
  });
};