import Mailjet from "node-mailjet";
import fs from "fs";
import { assetFile } from "../../utils/asset-file";

const mailjet = Mailjet.apiConnect(
  process.env.MAILJET_API_KEY!,
  process.env.MAILJET_SECRET_KEY!
);

export type SendEmailParams = {
  to: string;
  toName?: string;
  subject: string;
  text: string;
  html: string;
  /** Stable provider id used to de-duplicate deliveries. */
  customId?: string;
  attachment?: {
    filename: string;
    base64Content: string;
    contentType: string;
  };
};

const TEXT_DISCLAIMER = `
---
CONFIDENTIAL – FOR AUTHORIZED RECIPIENT ONLY

This email and the information contained herein are confidential and intended solely for the authorized recipient. Please do not share, forward, publish, or disclose your login credentials, temporary password, account information, or any other confidential information with any third party.

All content, materials, information, designs, software, trademarks, branding, concepts, documents, and intellectual property related to ARCADELX are the exclusive property of Nilee Games and Future Technologies Pvt. Ltd. and/or its respective licensors. All rights are reserved.

Any unauthorized copying, reproduction, distribution, modification, disclosure, commercial use, or dissemination of ARCADELX materials or intellectual property is strictly prohibited and may result in legal action under applicable laws.

If you have received this email in error, please delete it immediately and notify the ARCADELX team.
`;

export const sendEmail = async ({
  to,
  toName,
  subject,
  text,
  html,
  attachment,
  customId
}: SendEmailParams) => {

  const finalText = text + TEXT_DISCLAIMER;

  // Every template builds a complete document through `emailShell` (see email-theme.ts), so
  // the HTML is sent as-is. Wrapping it here would nest two frames and duplicate both the
  // logo and the confidentiality notice.
  const finalHtml = html;

  const request = await mailjet
    .post("send", { version: "v3.1" })
    .request({
      Messages: [
        {
          ...(customId ? { CustomID: customId } : {}),
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

          InlinedAttachments: [
          {
            ContentType: "image/png",
            Filename: "arcadelx-logo.png",
            // Resolved through asset-file.ts: the relative path used to break once the
            // source was bundled for Vercel, which silently stopped credential emails.
            Base64Content: fs
              .readFileSync(assetFile("arcadelx-logo.png"))
              .toString("base64"),

            ContentID: "arcadelx-logo",
          },
          ],
          Attachments: attachment ? [
            {
              ContentType: attachment.contentType,
              Filename: attachment.filename,
              Base64Content: attachment.base64Content,
            }
          ] : [],

        },
      ],
    });

  return request.body;
};

/**
 * Checks Mailjet for a message with the given CustomID.
 * Returns null when the provider query is unsupported or fails, so callers fall back to sending.
 */
export const checkEmailDelivery = async (
  customId: string
): Promise<{ delivered: boolean; deliveredAt?: Date; messageId?: string } | null> => {
  if (!customId) return null;
  try {
    const response: any = await (mailjet as any)
      .get('message', { version: 'v3' })
      .request({ CustomID: customId });

    if (response?.body?.Count > 0 && response?.body?.Data?.[0]) {
      const msg = response.body.Data[0];
      return {
        delivered: true,
        deliveredAt: msg.ArrivedAt ? new Date(msg.ArrivedAt) : new Date(),
        messageId: String(msg.ID),
      };
    }
    return { delivered: false };
  } catch {
    return null;
  }
};