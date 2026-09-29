import fs from "node:fs";
import path from "node:path";
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../utils/db";
import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { INVOICES_DIR } from "../../services/pdf/invoice.pdf";
import {
  queueInvoice,
  attemptDelivery,
  invoiceDeliveryKey,
  retryOwnedDelivery,
} from "../../services/email/delivery.service";
import { lockAgreementParties } from "../../services/agreement-rules";
import {
  CreateOrderSchema,
  OrderQuerySchema,
} from "@shared-types/validationSchemas/Orders/order.validation";

const reserveKiosks = async (
  tx: Prisma.TransactionClient,
  orgId: string,
  quantity: number,
  orderId: string,
) => {
  const kiosks = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Kiosk" WHERE "currentOrgId"=${orgId} AND status='AVAILABLE' AND "reservedOrderId" IS NULL
    ORDER BY "createdAt", id LIMIT ${quantity} FOR UPDATE SKIP LOCKED`;
  if (kiosks.length !== quantity)
    throw new ApiError(
      409,
      "Insufficient unreserved inventory; retry if another allocation is in progress",
    );
  const ids = kiosks.map((k) => k.id);
  const updated = await tx.kiosk.updateMany({
    where: {
      id: { in: ids },
      currentOrgId: orgId,
      status: "AVAILABLE",
      reservedOrderId: null,
    },
    data: { status: "RESERVED", reservedOrderId: orderId },
  });
  if (updated.count !== quantity)
    throw new ApiError(409, "Inventory changed during reservation");
  await tx.orderKiosk.createMany({
    data: ids.map((kioskId) => ({ orderId, kioskId })),
  });
};

async function lockedOrder(
  tx: Prisma.TransactionClient,
  id: string,
  orgId: string,
) {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${id} FOR UPDATE`;
  const order = await tx.order.findUnique({
    where: { id },
    include: {
      dispatchedKiosks: true,
      agreement: { include: { networkConnection: true } },
      parentOrg: { select: { type: true } },
      childOrg: { select: { type: true } },
    },
  });
  if (!order) throw new ApiError(404, "Order not found");
  if (order.parentOrgId !== orgId)
    throw new ApiError(403, "Unauthorized to modify this order");
  const network = order.agreement.networkConnection;
  if (
    order.parentOrgId === order.childOrgId ||
    order.agreement.parentOrgId !== order.parentOrgId ||
    order.agreement.childOrgId !== order.childOrgId ||
    network.initiatorOrgId !== order.parentOrgId ||
    network.receiverOrgId !== order.childOrgId ||
    !(
      (order.parentOrg.type === "COMPANY" &&
        ["DISTRIBUTOR", "PARTNER"].includes(order.childOrg.type)) ||
      (order.parentOrg.type === "DISTRIBUTOR" &&
        order.childOrg.type === "PARTNER")
    )
  ) {
    throw new ApiError(
      409,
      "Order relationship is inconsistent; reconciliation is required",
    );
  }
  return order;
}

async function lockedStock(
  tx: Prisma.TransactionClient,
  order: Awaited<ReturnType<typeof lockedOrder>>,
  status: "RESERVED" | "ASSIGNED",
) {
  const ids = order.dispatchedKiosks.map((row) => row.kioskId);
  if (ids.length !== order.quantity || ids.length === 0)
    throw new ApiError(
      409,
      "Order does not contain the required number of kiosks",
    );
  await tx.$queryRaw`SELECT id FROM "Kiosk" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  const kiosks = await tx.kiosk.findMany({ where: { id: { in: ids } } });
  if (
    kiosks.length !== order.quantity ||
    kiosks.some(
      (k) =>
        k.currentOrgId !== order.parentOrgId ||
        k.status !== status ||
        k.reservedOrderId !== order.id,
    )
  ) {
    throw new ApiError(
      409,
      "Kiosk ownership, state, or reservation no longer matches this order",
    );
  }
  return ids;
}

export const createOrder = asyncHandler(async (req, res) => {
  const { type, targetOrgId, quantity } = CreateOrderSchema.parse(req.body);
  const currentOrgId = req.membership!.organizationId;
  const parentOrgId = type === "REQUEST" ? targetOrgId : currentOrgId;
  const childOrgId = type === "REQUEST" ? currentOrgId : targetOrgId;
  const order = await prisma.$transaction(async (tx) => {
    const candidate = await tx.agreement.findFirst({
      where: { parentOrgId, childOrgId, status: "ACTIVE" },
    });
    if (!candidate)
      throw new ApiError(
        403,
        "Cannot create order: No active agreement exists between these organizations",
      );
    await lockAgreementParties(
      tx,
      parentOrgId,
      childOrgId,
      candidate.networkConnectionId,
    );
    const agreement = await tx.agreement.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    if (agreement.status !== "ACTIVE")
      throw new ApiError(403, "Agreement is no longer active");
    const year = new Date().getFullYear();
    const sequence = await tx.$queryRaw<
      [{ value: number }]
    >`INSERT INTO "OrderSequence" (year,value) VALUES (${year},1) ON CONFLICT (year) DO UPDATE SET value="OrderSequence".value+1 RETURNING value`;
    const depositPerMachine = agreement.depositAmountPerMachine;
    const nonRefundablePerMachine = agreement.nonRefundableAmountPerMachine;
    const totalDeposit = depositPerMachine * quantity;
    const totalNonRefundable = nonRefundablePerMachine * quantity;
    const taxAmount = Math.round(totalNonRefundable * 18) / 100;
    const row = await tx.order.create({
      data: {
        orderNumber: `ORD-${year}-${String(sequence[0].value).padStart(5, "0")}`,
        type,
        status: type === "REQUEST" ? "UNDER_REVIEW" : "APPROVED",
        parentOrgId,
        childOrgId,
        agreementId: agreement.id,
        quantity,
        depositPerMachine,
        nonRefundablePerMachine,
        totalDeposit,
        totalNonRefundable,
        taxAmount,
        grandTotal: totalDeposit + totalNonRefundable + taxAmount,
      },
    });
    if (type === "ALLOCATION") {
      await reserveKiosks(tx, parentOrgId, quantity, row.id);
      await queueInvoice(tx, parentOrgId, row.id);
    }
    return row;
  });
  if (type === "REQUEST")
    return res
      .status(201)
      .json(
        new ApiResponse(
          201,
          { order },
          "Order requested successfully. Pending approval.",
        ),
      );
  const invoiceEmailSent = await attemptDelivery(invoiceDeliveryKey(order.id));
  const updated = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
  });
  res
    .status(201)
    .json(
      new ApiResponse(
        201,
        {
          order: updated,
          invoiceEmailSent,
          invoiceReady: !!updated.invoiceFilename,
        },
        "Order created; invoice delivery queued",
      ),
    );
});

export const approveOrder = asyncHandler(async (req, res) => {
  const id = req.params.orderId;
  if (typeof id !== "string") throw new ApiError(400, "Invalid order ID");
  await prisma.$transaction(async (tx) => {
    const order = await lockedOrder(tx, id, req.membership!.organizationId);
    if (order.status !== "UNDER_REVIEW")
      throw new ApiError(
        400,
        `Cannot approve an order that is currently ${order.status}`,
      );
    await reserveKiosks(tx, order.parentOrgId, order.quantity, id);
    await tx.order.update({
      where: { id },
      data: { status: "APPROVED", paymentStatus: "PENDING" },
    });
    await queueInvoice(tx, order.parentOrgId, id);
  });
  const invoiceEmailSent = await attemptDelivery(invoiceDeliveryKey(id));
  const order = await prisma.order.findUniqueOrThrow({ where: { id } });
  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { order, invoiceEmailSent, invoiceReady: !!order.invoiceFilename },
        "Order approved; invoice delivery queued",
      ),
    );
});

export const retryOrderInvoice = asyncHandler(async (req, res) => {
  const id = req.params.orderId;
  if (typeof id !== "string") throw new ApiError(400, "Invalid order ID");
  const invoiceEmailSent = await retryOwnedDelivery(
    invoiceDeliveryKey(id),
    req.membership!.organizationId,
  );
  const order = await prisma.order.findUniqueOrThrow({ where: { id } });
  res
    .status(invoiceEmailSent ? 200 : 202)
    .json(
      new ApiResponse(
        invoiceEmailSent ? 200 : 202,
        { order, invoiceEmailSent, invoiceReady: !!order.invoiceFilename },
        invoiceEmailSent
          ? "Invoice delivered"
          : "Invoice delivery remains queued; retry later",
      ),
    );
});

export const markOrderAsPaid = asyncHandler(async (req, res) => {
  const id = req.params.orderId;
  if (typeof id !== "string") throw new ApiError(400, "Invalid order ID");
  const order = await prisma.$transaction(async (tx) => {
    const current = await lockedOrder(tx, id, req.membership!.organizationId);
    if (current.status !== "APPROVED" || current.paymentStatus === "PAID")
      throw new ApiError(400, "Order must be approved and not already paid");
    return tx.order.update({ where: { id }, data: { paymentStatus: "PAID" } });
  });
  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { order },
        "Payment verified. Order is ready for dispatch.",
      ),
    );
});

export const dispatchOrder = asyncHandler(async (req, res) => {
  const id = req.params.orderId;
  if (typeof id !== "string") throw new ApiError(400, "Invalid order ID");
  const order = await prisma.$transaction(async (tx) => {
    const current = await lockedOrder(tx, id, req.membership!.organizationId);
    if (current.status !== "APPROVED")
      throw new ApiError(400, "Order must be APPROVED before dispatch");
    if (current.paymentStatus !== "PAID")
      throw new ApiError(402, "Order payment status must be PAID");
    const ids = await lockedStock(tx, current, "RESERVED");
    await tx.kiosk.updateMany({
      where: { id: { in: ids } },
      data: { status: "ASSIGNED" },
    });
    return tx.order.update({ where: { id }, data: { status: "DISPATCHED" } });
  });
  res.status(200).json(new ApiResponse(200, { order }, "Order dispatched"));
});

export const deliverOrder = asyncHandler(async (req, res) => {
  const id = req.params.orderId;
  if (typeof id !== "string") throw new ApiError(400, "Invalid order ID");
  const order = await prisma.$transaction(async (tx) => {
    const current = await lockedOrder(tx, id, req.membership!.organizationId);
    if (current.status !== "DISPATCHED")
      throw new ApiError(400, "Order must be DISPATCHED before delivery");
    const ids = await lockedStock(tx, current, "ASSIGNED");
    const history = await tx.kioskAssignment.findMany({
      where: { kioskId: { in: ids }, assignedTo: null },
    });
    if (history.some((row) => row.organizationId !== current.parentOrgId))
      throw new ApiError(
        409,
        "Current assignment history does not match the supplier",
      );
    await tx.kioskAssignment.updateMany({
      where: { kioskId: { in: ids }, assignedTo: null },
      data: { assignedTo: new Date() },
    });
    await tx.kioskAssignment.createMany({
      data: ids.map((kioskId) => ({
        kioskId,
        organizationId: current.childOrgId,
        orderId: id,
        assignedById: req.user!.id,
      })),
    });
    await tx.kiosk.updateMany({
      where: { id: { in: ids } },
      data: {
        currentOrgId: current.childOrgId,
        status: "AVAILABLE",
        location: null,
        reservedOrderId: null,
      },
    });
    return tx.order.update({ where: { id }, data: { status: "DELIVERED" } });
  });
  res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { order },
        "Order delivered and kiosk ownership transferred",
      ),
    );
});

export const getOrderInvoice = asyncHandler(async (req, res) => {
  const id = req.params.orderId;
  if (typeof id !== "string") throw new ApiError(400, "Invalid order ID");
  const order = await prisma.order.findUnique({
    where: { id },
    select: { parentOrgId: true, childOrgId: true, invoiceFilename: true },
  });
  if (!order) throw new ApiError(404, "Order not found");
  if (
    ![order.parentOrgId, order.childOrgId].includes(
      req.membership!.organizationId,
    )
  )
    throw new ApiError(403, "Unauthorized to access this invoice");
  if (!order.invoiceFilename)
    throw new ApiError(404, "Invoice has not been generated yet");
  const file = path.resolve(INVOICES_DIR, order.invoiceFilename);
  if (path.dirname(file) !== INVOICES_DIR || !fs.existsSync(file))
    throw new ApiError(404, "Invoice file not found");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${path.basename(file)}"`,
  );
  res.sendFile(file);
});

export const getOrderRequests = asyncHandler(async (req, res) => {
  const query = OrderQuerySchema.parse(req.query);
  const organizationId = req.membership!.organizationId;
  const orders = await prisma.order.findMany({
    where: {
      OR: [{ parentOrgId: organizationId }, { childOrgId: organizationId }],
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
    },
    include: {
      parentOrg: { select: { id: true, name: true } },
      childOrg: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res
    .status(200)
    .json(
      new ApiResponse(200, { orders }, "Order requests fetched successfully"),
    );
});
