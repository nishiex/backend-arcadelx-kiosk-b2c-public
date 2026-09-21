import { sendEmail } from "./email.service";

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

  await sendEmail({
    to: email,
    toName: name,

    subject: `Your ${organizationType} account has been created`,

    text: `
Hello ${name},

Your organization account has been created successfully.

Organization: ${organizationName}
Organization Type: ${organizationType}

Login:
${loginUrl}

Email:
${email}

Temporary Password:
${temporaryPassword}

Please login and change your password after your first login.

Regards,
${process.env.MAIL_FROM_NAME}
`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #222;">
        
        <h2>Welcome to ${process.env.MAIL_FROM_NAME}-${organizationType}Account Created</h2>

        <p>Hello ${name},</p>

        <p>
          Your <strong>${organizationType}</strong> organization account
          has been created successfully.
        </p>
        <p>
          <strong>Organization:</strong> ${organizationName}
        </p>

        <p>
          <strong>Organization Type:</strong> ${organizationType}
        </p>

        <hr />

        <h3>Login Details</h3>

        <p>
          <strong>Email:</strong> ${email}
        </p>

        <p>
          <strong>Temporary Password:</strong> ${temporaryPassword}
        </p>

        <p>
          <a
            href="${loginUrl}"
            style="
              display: inline-block;
              padding: 12px 20px;
              background-color: #2563eb;
              color: white;
              text-decoration: none;
              border-radius: 6px;
            "
          >
            Login to your account
          </a>
        </p>

        <p>
          Please use the above temporary credentials to log in to your account. For security purposes, we strongly recommend changing your password immediately after your first login.
        </p>
        <P>
          We look forward to working with you and building the ARCADELX network together.
        </p>
        <p>
          Regards,<br />
          Team ${process.env.MAIL_FROM_NAME},<br />
          Nilee Games and Future Technologies Pvt. Ltd.
        </p>


      </div>
    `,
  });
};

