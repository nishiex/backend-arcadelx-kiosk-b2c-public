import { prisma } from "../../utils/db";
import { sendEmail } from "./email.service";
import {
  emailButton,
  emailCallout,
  emailDataRows,
  emailParagraph,
  emailShell,
} from "./email-theme";

type AgreementActivatedEmailParams = {
  email: string;
  name: string;
  organizationName: string;
  counterpartyName: string;
  yourSharePct: number;
  theirSharePct: number;
  depositPerMachine: number;
  nonRefundablePerMachine: number;
  effectiveFrom: Date;
};

const inr = (value: number) =>
  `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const pct = (value: number) =>
  `${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;

/**
 * Tells the receiving organization that an agreement naming it is now active.
 * The Company (or Distributor) that creates the terms already knows; the child
 * organization otherwise only learns about it by visiting the Agreements page.
 */
export const sendAgreementActivatedEmail = async ({
  email,
  name,
  organizationName,
  counterpartyName,
  yourSharePct,
  theirSharePct,
  depositPerMachine,
  nonRefundablePerMachine,
  effectiveFrom,
}: AgreementActivatedEmailParams) => {
  const loginUrl = process.env.FRONTEND_LOGIN_URL!;
  const productName = process.env.MAIL_FROM_NAME ?? "ARCADELX";
  const effective = new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(effectiveFrom);

  await sendEmail({
    to: email,
    toName: name,

    subject: `Agreement activated with ${counterpartyName}`,

    text: `
Hello ${name},

${counterpartyName} has activated a revenue-sharing agreement with ${organizationName}.

Your share: ${pct(yourSharePct)}
${counterpartyName} share: ${pct(theirSharePct)}
Refundable deposit per kiosk: ${inr(depositPerMachine)}
Non-refundable amount per kiosk: ${inr(nonRefundablePerMachine)}
Effective from: ${effective}

Review the terms in the Agreements page before your first allocation:
${loginUrl}

Regards,
Team ${productName}
`,

    html: emailShell({
      preheader: `${counterpartyName} activated an agreement with ${organizationName}`,
      heading: "Agreement activated",
      subtitle: `${counterpartyName} has set the terms for your organization.`,
      content: [
        emailParagraph(
          `Hello ${name}, a revenue-sharing agreement between <strong>${organizationName}</strong> and <strong>${counterpartyName}</strong> is now active.`,
        ),
        emailDataRows([
          { label: "Counterparty", value: counterpartyName, mono: false },
          { label: "Your share", value: pct(yourSharePct), mono: false },
          { label: `${counterpartyName} share`, value: pct(theirSharePct), mono: false },
          { label: "Refundable deposit per kiosk", value: inr(depositPerMachine) },
          { label: "Non-refundable amount per kiosk", value: inr(nonRefundablePerMachine) },
          { label: "Effective from", value: effective, mono: false },
        ]),
        emailCallout(
          "Review the terms in the Agreements page before your first allocation. Contact the ArcadeLX team if anything looks wrong.",
        ),
        emailButton("Review the agreement", loginUrl),
      ].join(""),
    }),
  });
};

/**
 * Looks up the activated agreement and emails the child organization's owner.
 * Best-effort: callers must not fail the agreement when delivery fails.
 */
export const notifyAgreementActivated = async (agreementId: string) => {
  const agreement = await prisma.agreement.findUnique({
    where: { id: agreementId },
    select: {
      parentSharePct: true,
      childSharePct: true,
      depositAmountPerMachine: true,
      nonRefundableAmountPerMachine: true,
      effectiveFrom: true,
      parentOrg: { select: { name: true } },
      childOrg: {
        select: {
          name: true,
          owner: { select: { name: true, email: true } },
        },
      },
    },
  });

  const owner = agreement?.childOrg.owner;
  if (!agreement || !owner?.email) return;

  await sendAgreementActivatedEmail({
    email: owner.email,
    name: owner.name,
    organizationName: agreement.childOrg.name,
    counterpartyName: agreement.parentOrg.name,
    yourSharePct: Number(agreement.childSharePct),
    theirSharePct: Number(agreement.parentSharePct),
    depositPerMachine: agreement.depositAmountPerMachine,
    nonRefundablePerMachine: agreement.nonRefundableAmountPerMachine,
    effectiveFrom: agreement.effectiveFrom,
  });
};
