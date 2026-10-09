import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../utils/db";
import { env } from "../../config/env";
import { ApiError } from "../../utils/ApiError";
import { sendOrganizationCredentialsEmail } from "./auth.email";
import { sendEmail } from "./email.service";
import { emailDataRows, emailParagraph, emailShell } from "./email-theme";
import { generateInvoicePDF, INVOICES_DIR } from "../pdf/invoice.pdf";
import { REVENUE_REPORTS_DIR } from '../pdf/revenue.pdf';

type Credentials = {
  email: string;
  name: string;
  organizationName: string;
  organizationType: string;
  temporaryPassword: string;
};
type Payload =
  | { kind: "CREDENTIALS"; credentials: Credentials }
  | { kind: "INVOICE"; orderId: string }
  | { kind: 'REVENUE'; statementId: string };
// Separate cryptographic domain; the stable internal secret must remain available
// until pending deliveries are sent. No temporary password is stored in plaintext.
const key = crypto
  .createHash("sha256")
  .update(`email-delivery:v1:${env.INTERNAL_API_SECRET}`)
  .digest();
function encrypt(payload: Payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((value) => value.toString("base64"))
    .join(".");
}
function decrypt(value: string): Payload {
  const [iv, tag, data] = value
    .split(".")
    .map((part) => Buffer.from(part, "base64"));
  if (!iv || !tag || !data) throw new Error("Invalid delivery payload");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8"),
  ) as Payload;
}
export const credentialDeliveryKey = (organizationId: string) =>
  `organization:${organizationId}:credentials`;
export const invoiceDeliveryKey = (orderId: string) =>
  `order:${orderId}:invoice`;
export const revenueDeliveryKey = (statementId: string) => `revenue:${statementId}:statement`;

export async function queueRevenueStatement(tx: Prisma.TransactionClient, organizationId: string, statementId: string) {
  return tx.emailDelivery.upsert({
    where: { key: revenueDeliveryKey(statementId) }, update: {},
    create: { key: revenueDeliveryKey(statementId), kind: 'REVENUE', ownerOrganizationId: organizationId, payload: encrypt({ kind: 'REVENUE', statementId }) },
  });
}

async function deliverRevenueStatement(statementId: string) {
  const statement = await prisma.revenueStatement.findUniqueOrThrow({ where: { id: statementId },
    include: { organization: { select: { owner: { select: { email: true } } } } },
  });
  const root = path.resolve(REVENUE_REPORTS_DIR);
  const file = path.resolve(root, statement.pdfPath);
  if (!file.startsWith(root + path.sep)) throw new Error('Invalid report path');
  const buffer = await fs.readFile(file);
  await sendEmail({
    to: statement.organization.owner.email,
    subject: `ArcadeLX Monthly Revenue Statement: ${statement.Month}/${statement.Year}`,
    text:
      `Your revenue statement for ${statement.Month}/${statement.Year} is attached. ` +
      'Please review it and the payout calculations.',
    html: emailShell({
      preheader: `Your revenue statement for ${statement.Month}/${statement.Year}`,
      heading: 'Monthly revenue statement',
      subtitle: `Statement period ${statement.Month}/${statement.Year}`,
      content: [
        emailParagraph(
          'Please review the attached statement and its payout calculations. All amounts are in INR.',
        ),
        emailDataRows([
          { label: 'Statement', value: path.basename(file), mono: false },
          { label: 'Period', value: `${statement.Month}/${statement.Year}`, mono: false },
        ]),
      ].join(''),
    }),
    attachment: { filename: path.basename(file), base64Content: buffer.toString('base64'), contentType: 'application/pdf' },
  });
}

export async function queueCredentials(
  tx: Prisma.TransactionClient,
  ownerOrganizationId: string,
  organizationId: string,
  credentials: Credentials,
) {
  return tx.emailDelivery.create({
    data: {
      key: credentialDeliveryKey(organizationId),
      kind: "CREDENTIALS",
      ownerOrganizationId,
      payload: encrypt({ kind: "CREDENTIALS", credentials }),
    },
  });
}
export async function queueInvoice(
  tx: Prisma.TransactionClient,
  ownerOrganizationId: string,
  orderId: string,
) {
  return tx.emailDelivery.create({
    data: {
      key: invoiceDeliveryKey(orderId),
      kind: "INVOICE",
      ownerOrganizationId,
      payload: encrypt({ kind: "INVOICE", orderId }),
    },
  });
}

async function deliverInvoice(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      parentOrg: { select: { name: true } },
      childOrg: { select: { name: true, owner: { select: { email: true } } } },
    },
  });
  let invoiceFilename = order.invoiceFilename;
  if (
    !invoiceFilename ||
    !(await fs.stat(path.join(INVOICES_DIR, invoiceFilename)).catch(() => null))
  ) {
    invoiceFilename = await generateInvoicePDF({
      ...order,
      parentOrgName: order.parentOrg.name,
      childOrgName: order.childOrg.name,
      date: order.createdAt,
    });
  }
  await prisma.order.update({
    where: { id: orderId },
    data: { invoiceFilename, invoiceUrl: `/api/orders/${orderId}/invoice` },
  });
  const buffer = await fs.readFile(path.join(INVOICES_DIR, invoiceFilename));
  await sendEmail({
    to: order.childOrg.owner.email,
    subject: `ArcadeLX Order Invoice: ${order.orderNumber}`,
    text:
      `Invoice for order ${order.orderNumber}: ${order.quantity} kiosks, ` +
      `total INR ${order.grandTotal.toFixed(2)}. Please review the attached invoice.`,
    html: emailShell({
      preheader: `Invoice for ${order.orderNumber}`,
      heading: 'Order invoice',
      subtitle: `Order ${order.orderNumber}`,
      content: [
        emailParagraph('Please review the attached invoice for this order. All amounts are in INR.'),
        emailDataRows([
          { label: 'Order', value: order.orderNumber },
          { label: 'Quantity', value: `${order.quantity} kiosks`, mono: false },
          { label: 'Total', value: `INR ${order.grandTotal.toFixed(2)}` },
        ]),
      ].join(''),
    }),
    attachment: {
      filename: invoiceFilename,
      base64Content: buffer.toString("base64"),
      contentType: "application/pdf",
    },
  });
}

// A durable, explicitly retryable delivery. Leasing prevents concurrent sends;
// a crashed attempt becomes retryable after two minutes. Sent calls are idempotent.
// As with any SMTP/API provider, ambiguous acceptance may result in a duplicate
// email on retry; it never creates another account/order or changes the password.
export async function attemptDelivery(deliveryKey: string): Promise<boolean> {
  let leaseId: string | undefined;
  try {
    const delivery = await prisma.emailDelivery.findUnique({
      where: { key: deliveryKey },
    });
    if (!delivery) return false;
    if (delivery.sentAt) return true;
    leaseId = crypto.randomUUID();
    const claimed = await prisma.emailDelivery.updateMany({
      where: {
        id: delivery.id,
        sentAt: null,
        OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }],
      },
      data: {
        leaseId,
        lockedUntil: new Date(Date.now() + 120000),
        attempts: { increment: 1 },
      },
    });
    if (claimed.count !== 1) return false;
    const payload = decrypt(delivery.payload);
    if (payload.kind === "CREDENTIALS")
      await sendOrganizationCredentialsEmail(payload.credentials);
    else if (payload.kind === 'REVENUE') await deliverRevenueStatement(payload.statementId);
    else await deliverInvoice(payload.orderId);
    await prisma.emailDelivery.updateMany({
      where: { id: delivery.id, leaseId },
      data: {
        sentAt: new Date(),
        payload: "",
        leaseId: null,
        lockedUntil: null,
      },
    });
    return true;
  } catch (error) {
    // Keep the queued operation recoverable and never expose provider internals. The cause is
    // still logged in sanitized form: discarding it silently left a production delivery
    // failure with no diagnostic at all, only an incremented attempt count.
    const reason = (error instanceof Error
      ? `${error.name}: ${error.message}`.split("\n")[0] ?? ""
      : String(error)
    ).slice(0, 300);
    console.error("[email-delivery] attempt failed", { key: deliveryKey, reason });
    if (leaseId)
      await prisma.emailDelivery
        .updateMany({
          where: { key: deliveryKey, leaseId },
          data: { leaseId: null, lockedUntil: null },
        })
        .catch(() => undefined);
    return false;
  }
}

export async function retryOwnedDelivery(
  deliveryKey: string,
  ownerOrganizationId: string,
) {
  const job = await prisma.emailDelivery.findFirst({
    where: { key: deliveryKey, ownerOrganizationId },
  });
  if (!job) throw new ApiError(404, "Delivery not found");
  return attemptDelivery(deliveryKey);
}
