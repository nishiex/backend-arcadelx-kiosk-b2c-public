import { sendEmail } from "./email.service";
import {
  emailButton,
  emailCallout,
  emailCredential,
  emailDataRows,
  emailParagraph,
  emailShell,
} from "./email-theme";

type OrganizationCredentialsEmailParams = {
  email: string;
  name: string;
  organizationName: string;
  organizationType: string;
  temporaryPassword: string;
};

export const sendOrganizationCredentialsEmail = async ({
  email,
  name,
  organizationName,
  organizationType,
  temporaryPassword,
}: OrganizationCredentialsEmailParams) => {
  const loginUrl = process.env.FRONTEND_LOGIN_URL!;
  const productName = process.env.MAIL_FROM_NAME ?? "ARCADELX";

  // The heading previously read "Welcome to ARCADELX-DISTRIBUTORAccount Created", because
  // the template concatenated `-${organizationType}Account Created` with no space.
  const heading = `Welcome to ${productName}`;
  const subtitle = `Your ${organizationType} account has been created.`;

  await sendEmail({
    to: email,
    toName: name,

    subject: `Your ${organizationType} account has been created`,

    text: `
Hello ${name},

Your ${organizationType} organization account has been created successfully.

Organization: ${organizationName}
Organization Type: ${organizationType}

Login: ${loginUrl}
Email: ${email}

Sign in with the generated password from your welcome email, then set your own password
from Settings straight away and keep it private.

Regards,
Team ${process.env.MAIL_FROM_NAME}
`,

    html: emailShell({
      preheader: `Sign-in details for ${organizationName}`,
      heading,
      subtitle,
      content: [
        emailParagraph(
          `Hello ${name}, your <strong>${organizationType}</strong> organization account has been created successfully.`,
        ),
        emailDataRows([
          { label: "Organization", value: organizationName, mono: false },
          { label: "Organization type", value: organizationType, mono: false },
          { label: "Email", value: email },
        ]),
        emailParagraph("Sign in with this password to get started:"),
        emailCredential(temporaryPassword),
        emailCallout(
          "Set your own password from Settings straight after your first sign-in. Anyone who can read this email can sign in as you until you do.",
          "destructive",
        ),
        emailButton("Sign in to your account", loginUrl),
      ].join(""),
    }),
  });
};
