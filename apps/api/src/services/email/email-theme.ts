/**
 * Email design system, matched to the dashboard.
 *
 * The dashboard's look comes from the OKLCH tokens in
 * `apps/web/next-monorepo/packages/ui/src/styles/globals.css`: white cards on a muted
 * page, 1px light borders, 10px radii, near-black primary buttons with near-white text,
 * grey secondary text, and monospace for machine codes, order numbers and credentials.
 *
 * Email clients cannot use CSS custom properties or `oklch()`, so the palette is baked in
 * as sRGB hex values converted from those exact tokens (`output/email-palette.json` holds
 * the derivation). Everything here is table-free block layout with inline styles, which is
 * what actually renders across clients.
 */

export const EMAIL_COLORS = {
  background: "#f5f5f5", // --muted, the dashboard's recessed page tone
  card: "#ffffff", // --card
  foreground: "#0a0a0a", // --foreground
  muted: "#f5f5f5", // --muted
  mutedForeground: "#737373", // --muted-foreground
  border: "#e5e5e5", // --border
  primary: "#171717", // --primary (near-black, as the dashboard's buttons)
  primaryForeground: "#fafafa", // --primary-foreground
  destructive: "#e7000b", // --destructive
} as const;

const RADIUS = "10px";
/** The dashboard renders machine codes and numbers in a mono face; credentials match it. */
const FONT_SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const FONT_MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

/** Small uppercase label above a value, mirroring the dashboard's micro-labels. */
export const emailLabel = (text: string) =>
  `<p style="margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${EMAIL_COLORS.mutedForeground};">${text}</p>`;

export const emailHeading = (text: string) =>
  `<h1 style="margin:0 0 8px;font-size:20px;line-height:1.3;font-weight:600;color:${EMAIL_COLORS.foreground};">${text}</h1>`;

export const emailSubtitle = (text: string) =>
  `<p style="margin:0;font-size:14px;line-height:1.5;color:${EMAIL_COLORS.mutedForeground};">${text}</p>`;

export const emailParagraph = (text: string) =>
  `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:${EMAIL_COLORS.foreground};">${text}</p>`;

export const emailStrong = (text: string) =>
  `<strong style="font-weight:600;color:${EMAIL_COLORS.foreground};">${text}</strong>`;

export const emailDivider = () =>
  `<div style="height:1px;background:${EMAIL_COLORS.border};margin:20px 0;"></div>`;

/** Recessed panel, like the dashboard's `bg-muted/30` blocks. */
export const emailPanel = (content: string) =>
  `<div style="background:${EMAIL_COLORS.muted};border:1px solid ${EMAIL_COLORS.border};border-radius:${RADIUS};padding:16px;margin:0 0 14px;">${content}</div>`;

/**
 * Label/value rows for structured data. Values default to mono, matching how the dashboard
 * shows machine codes, order numbers and quantities.
 */
export const emailDataRows = (
  rows: { label: string; value: string; mono?: boolean }[],
) =>
  `<div style="background:${EMAIL_COLORS.muted};border:1px solid ${EMAIL_COLORS.border};border-radius:${RADIUS};padding:4px 16px;margin:0 0 16px;">` +
  rows
    .map(
      (row, index) => `
    <div style="padding:12px 0;${index > 0 ? `border-top:1px solid ${EMAIL_COLORS.border};` : ""}">
      ${emailLabel(row.label)}
      <p style="margin:0;font-size:14px;line-height:1.5;color:${EMAIL_COLORS.foreground};${row.mono === false ? "" : `font-family:${FONT_MONO};`}word-break:break-all;">${row.value}</p>
    </div>`,
    )
    .join("") +
  `</div>`;

/**
 * A credential or code. Monospace and spaced so characters cannot be misread: the mixed
 * `l`/`I` glyph problem that made an emailed password ambiguous is exactly what a
 * typewriter face avoids.
 */
export const emailCredential = (value: string) =>
  `<div style="background:${EMAIL_COLORS.card};border:1px solid ${EMAIL_COLORS.border};border-radius:${RADIUS};padding:14px 16px;margin:0 0 16px;">
    <div style="font-family:${FONT_MONO};font-size:20px;line-height:1.4;font-weight:600;letter-spacing:0.12em;color:${EMAIL_COLORS.foreground};word-break:break-all;">${value}</div>
  </div>`;

/** Primary action, matching the dashboard's near-black button. */
export const emailButton = (label: string, href: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;"><tr>
    <td style="background:${EMAIL_COLORS.primary};border-radius:${RADIUS};">
      <a href="${href}" style="display:inline-block;padding:11px 20px;font-family:${FONT_SANS};font-size:14px;font-weight:600;color:${EMAIL_COLORS.primaryForeground};text-decoration:none;">${label}</a>
    </td>
  </tr></table>`;

/** Attention note; destructive for warnings, muted for neutral advice. */
export const emailCallout = (text: string, tone: "neutral" | "destructive" = "neutral") => {
  const destructive = tone === "destructive";
  return `<div style="border-left:3px solid ${destructive ? EMAIL_COLORS.destructive : EMAIL_COLORS.border};background:${EMAIL_COLORS.muted};border-radius:0 ${RADIUS} ${RADIUS} 0;padding:12px 14px;margin:0 0 16px;">
    <p style="margin:0;font-size:13px;line-height:1.6;color:${destructive ? EMAIL_COLORS.destructive : EMAIL_COLORS.mutedForeground};">${text}</p>
  </div>`;
};

/**
 * The shared shell: muted page, centred card, header wordmark, footer.
 *
 * `preheader` is the inbox preview line; a zero-height hidden div keeps it from showing in
 * the body. `recipient`/`note` make up the footer.
 */
export const emailShell = ({
  preheader,
  heading,
  subtitle,
  content,
  logoContentId = "arcadelx-logo",
  productName = process.env.MAIL_FROM_NAME ?? "ARCADELX",
}: {
  preheader?: string;
  heading?: string;
  subtitle?: string;
  content: string;
  logoContentId?: string;
  productName?: string;
}) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${heading ?? productName}</title>
</head>
<body style="margin:0;padding:0;background:${EMAIL_COLORS.background};">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>` : ""}
  <div style="padding:28px 16px;background:${EMAIL_COLORS.background};">
    <div style="max-width:600px;margin:0 auto;font-family:${FONT_SANS};">

      <!-- Brand -->
      <div style="padding:0 0 20px;text-align:center;">
        <img src="cid:${logoContentId}" alt="${productName}" width="150" style="display:block;margin:0 auto;max-width:150px;height:auto;border:0;" />
      </div>

      <!-- Card -->
      <div style="background:${EMAIL_COLORS.card};border:1px solid ${EMAIL_COLORS.border};border-radius:${RADIUS};padding:28px;">
        ${heading ? emailHeading(heading) : ""}
        ${subtitle ? emailSubtitle(subtitle) : ""}
        ${heading || subtitle ? `<div style="height:20px;"></div>` : ""}
        ${content}
      </div>

      <!-- Footer -->
      <div style="padding:18px 4px 0;text-align:center;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:${EMAIL_COLORS.mutedForeground};">
          ${productName} &middot; Nilee Games and Future Technologies Pvt. Ltd.
        </p>
      </div>

    </div>
  </div>
</body>
</html>`;

/** The mandatory confidentiality notice, restyled to the same tokens. */
export const emailDisclaimer = () =>
  `<div style="margin:20px 0 0;padding-top:16px;border-top:1px solid ${EMAIL_COLORS.border};">
    <p style="margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${EMAIL_COLORS.foreground};">
      Confidential &ndash; for authorised recipient only
    </p>
    <p style="margin:0 0 8px;font-size:11px;line-height:1.5;color:${EMAIL_COLORS.mutedForeground};">
      This email and the information contained herein are confidential and intended solely for the authorized recipient. Please do not share, forward, publish, or disclose your login credentials, temporary password, account information, or any other confidential information with any third party.
    </p>
    <p style="margin:0 0 8px;font-size:11px;line-height:1.5;color:${EMAIL_COLORS.mutedForeground};">
      All content, materials, information, designs, software, trademarks, branding, concepts, documents, and intellectual property related to ARCADELX are the exclusive property of <strong style="color:${EMAIL_COLORS.foreground};">Nilee Games and Future Technologies Pvt. Ltd.</strong> and/or its respective licensors. All rights are reserved.
    </p>
    <p style="margin:0 0 8px;font-size:11px;line-height:1.5;color:${EMAIL_COLORS.mutedForeground};">
      Any unauthorized copying, reproduction, distribution, modification, disclosure, commercial use, or dissemination of ARCADELX materials or intellectual property is strictly prohibited and may result in legal action under applicable laws.
    </p>
    <p style="margin:0;font-size:11px;line-height:1.5;color:${EMAIL_COLORS.mutedForeground};">
      If you have received this email in error, please delete it immediately and notify the ARCADELX team.
    </p>
  </div>`;
