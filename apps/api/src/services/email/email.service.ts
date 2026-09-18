import Mailjet from "node-mailjet";

const mailjet = Mailjet.apiConnect(
  process.env.MAILJET_API_KEY!,
  process.env.MAILJET_SECRET_KEY!
);

type SendEmailParams = {
  to: string;
  toName?: string;
  subject: string;
  text: string;
  html: string;
};

// Define standard disclaimers
const TEXT_DISCLAIMER = `
---
CONFIDENTIAL – FOR AUTHORIZED RECIPIENT ONLY

This email and the information contained herein are confidential and intended solely for the authorized recipient. Please do not share, forward, publish, or disclose your login credentials, temporary password, account information, or any other confidential information with any third party.

All content, materials, information, designs, software, trademarks, branding, concepts, documents, and intellectual property related to ARCADELX are the exclusive property of Nilee Games and Future Technologies Pvt. Ltd. and/or its respective licensors. All rights are reserved.

Any unauthorized copying, reproduction, distribution, modification, disclosure, commercial use, or dissemination of ARCADELX materials or intellectual property is strictly prohibited and may result in legal action under applicable laws.

If you have received this email in error, please delete it immediately and notify the ARCADELX team.
`;

const HTML_DISCLAIMER = `
  <br /><br />
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
  <div style="font-size: 11px; color: #6b7280; line-height: 1.4; font-family: Arial, sans-serif;">
    <p style="font-weight: bold; color: #374151; margin-bottom: 8px;">
      CONFIDENTIAL &ndash; FOR AUTHORIZED RECIPIENT ONLY
    </p>
    <p style="margin-bottom: 8px;">
      This email and the information contained herein are confidential and intended solely for the authorized recipient. Please do not share, forward, publish, or disclose your login credentials, temporary password, account information, or any other confidential information with any third party.
    </p>
    <p style="margin-bottom: 8px;">
      All content, materials, information, designs, software, trademarks, branding, concepts, documents, and intellectual property related to ARCADELX are the exclusive property of <strong>Nilee Games and Future Technologies Pvt. Ltd.</strong> and/or its respective licensors. All rights are reserved.
    </p>
    <p style="margin-bottom: 8px;">
      Any unauthorized copying, reproduction, distribution, modification, disclosure, commercial use, or dissemination of ARCADELX materials or intellectual property is strictly prohibited and may result in legal action under applicable laws.
    </p>
    <p style="margin-bottom: 0;">
      If you have received this email in error, please delete it immediately and notify the ARCADELX team.
    </p>
  </div>
`;

export const sendEmail = async ({
  to,
  toName,
  subject,
  text,
  html,
}: SendEmailParams) => {
  // Automatically append the disclaimer to text and HTML versions
  const finalText = text + TEXT_DISCLAIMER;
  const finalHtml = html + HTML_DISCLAIMER;

  const request = await mailjet
    .post("send", { version: "v3.1" })
    .request({
      Messages: [
        {
          From: {
            Email: process.env.MAIL_FROM_EMAIL!,
            Name: process.env.MAIL_FROM_NAME!,
          },
          To: [
            {
              Email: to,
              Name: toName,
            },
          ],
          Subject: subject,
          TextPart: finalText,
          HTMLPart: finalHtml,
        },
      ],
    });

  return request.body;
};