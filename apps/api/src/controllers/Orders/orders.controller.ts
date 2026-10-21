import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../utils/db";
import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { renderInvoicePDF } from "../../services/pdf/invoice.pdf";
import {
  queueInvoice,
  attemptDelivery,
  invoiceDeliveryKey,
  retryOwnedDelivery,
} from "../../services/email/delivery.service";
import { lockAgreementParties, requireImmediateSupplier } from "../../services/agreement-rules";
import { requireWorkflow } from '../../services/workflow-readiness';
import {
  CreateOrderSchema,
  DeliverOrderSchema,
  OrderQuerySchema,
  OrderParamsSchema,
} from "@shared-types/validationSchemas/Orders/order.validation";

const REQUESTABLE_KIOSK_STATUSES = ["AVAILABLE", "INSTALLED"] as const;

const reserveKiosks = async (
  tx: Prisma.TransactionClient,
  orgId: string,
  quantity: number,
  orderId: string,
  model?: string,
) => {
  // Batch-created kiosks start AVAILABLE and may become INSTALLED when hardware is
  // paired. Both states represent real, unreserved supplier stock that can be
  // requested; reservation moves either state to RESERVED.
  //
  // Deterministic selection: oldest first, then by machine code. Ordering by `id`
  // alone is arbitrary because ids are random UUIDs, so kiosks sharing a
  // `createdAt` (batch-created fleets share one) were picked in no meaningful order
  // and a request could receive an unexplained, model-mixed set. `machineCode` is
  // unique, making this a total order: the same inventory always yields the same
  // kiosks, and a batch allocation now follows the machine codes.
  //
  // FOR UPDATE SKIP LOCKED makes the availability check atomic: two concurrent orders
  // cannot select the same row, and the guarded updateMany below re-checks the same
  // predicate so a row that changed between SELECT and UPDATE cannot slip through.
  const kiosks = model
    ? await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Kiosk" WHERE "currentOrgId"=${orgId} AND status IN ('AVAILABLE', 'INSTALLED') AND "reservedOrderId" IS NULL AND model=${model}
        ORDER BY "createdAt", "machineCode", id LIMIT ${quantity} FOR UPDATE SKIP LOCKED`
    : await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Kiosk" WHERE "currentOrgId"=${orgId} AND status IN ('AVAILABLE', 'INSTALLED') AND "reservedOrderId" IS NULL
        ORDER BY "createdAt", "machineCode", id LIMIT ${quantity} FOR UPDATE SKIP LOCKED`;
  if (kiosks.length !== quantity) {
    // Distinguish missing model stock from stock that is already committed.
    const [installedTotal] = model
      ? await tx.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM "Kiosk" WHERE "currentOrgId"=${orgId} AND status IN ('AVAILABLE', 'INSTALLED') AND model=${model}`
      : await tx.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM "Kiosk" WHERE "currentOrgId"=${orgId} AND status IN ('AVAILABLE', 'INSTALLED')`;
    if (Number(installedTotal?.n ?? 0) === 0) {
      throw new ApiError(
        409,
        model
          ? `No kiosks of model "${model}" are available from this supplier.`
          : "No kiosks are available to reserve from this supplier.",
      );
    }
    throw new ApiError(
      409,
        model
          ? `Insufficient unreserved kiosks of model "${model}"; retry if another allocation is in progress.`
          : "Insufficient unreserved inventory; retry if another allocation is in progress",
    );
  }
  const ids = kiosks.map((k) => k.id);
  const updated = await tx.kiosk.updateMany({
    where: {
      id: { in: ids },
      currentOrgId: orgId,
      status: { in: [...REQUESTABLE_KIOSK_STATUSES] },
      reservedOrderId: null,
      ...(model ? { model } : {}),
    },
    data: { status: "RESERVED", reservedOrderId: orderId },
  });
  if (updated.count !== quantity)
    throw new ApiError(409, "Inventory changed during reservation");
  await tx.orderKiosk.createMany({
    data: ids.map((kioskId) => ({ orderId, kioskId })),
  });
};

const assertRequestModelAvailable = async (
  tx: Prisma.TransactionClient,
  supplierOrgId: string,
  model: string,
  quantity: number,
) => {
  // Serialize requests and approvals for one supplier so multiple requests cannot
  // independently claim the same unreserved model inventory.
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${supplierOrgId} FOR UPDATE`;
  const available = await tx.kiosk.count({
    where: {
      currentOrgId: supplierOrgId,
      status: { in: [...REQUESTABLE_KIOSK_STATUSES] },
      reservedOrderId: null,
      model,
    },
  });
  const pending = await tx.order.aggregate({
    where: {
      parentOrgId: supplierOrgId,
      type: "REQUEST",
      status: "UNDER_REVIEW",
      requestedModel: model,
    },
    _sum: { quantity: true },
  });
  const remaining = Math.max(0, available - (pending._sum.quantity ?? 0));
  if (remaining < quantity) {
    throw new ApiError(
      409,
      `Only ${remaining} unreserved installed kiosk(s) of model "${model}" are available from this supplier; requested ${quantity}.`,
      { model, available, pendingRequests: pending._sum.quantity ?? 0 },
    );
  }
};

export const getRequestModelAvailability = asyncHandler(async (req, res) => {
  await requireWorkflow("orderDecisions");
  const requesterOrgId = req.membership!.organizationId;
  const requesterOrgType = req.membership!.type;
  const result = await prisma.$transaction(async (tx) => {
    const agreement = await requireImmediateSupplier(
      tx,
      requesterOrgId,
      requesterOrgType,
    );
    const [inventory, pending] = await Promise.all([
      tx.kiosk.groupBy({
        by: ["model"],
        where: {
          currentOrgId: agreement.parentOrgId,
          status: { in: [...REQUESTABLE_KIOSK_STATUSES] },
          reservedOrderId: null,
        },
        _count: { _all: true },
      }),
      tx.order.groupBy({
        by: ["requestedModel"],
        where: {
          parentOrgId: agreement.parentOrgId,
          type: "REQUEST",
          status: "UNDER_REVIEW",
          requestedModel: { not: null },
        },
        _sum: { quantity: true },
      }),
    ]);
    const pendingByModel = new Map(
      pending.map((row) => [
        row.requestedModel!,
        row._sum.quantity ?? 0,
      ]),
    );
    return {
      supplier: agreement.parentOrg,
      models: inventory
        .flatMap((row) =>
          row.model === null
            ? []
            : [{
                model: row.model,
                availableQuantity: Math.max(
                  0,
                  row._count._all - (pendingByModel.get(row.model) ?? 0),
                ),
              }],
        )
        .sort((a, b) => a.model.localeCompare(b.model)),
    };
  });
  res.json(
    new ApiResponse(
      200,
      result,
      "Request model availability fetched successfully",
    ),
  );
});

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
  await requireWorkflow('orderDecisions');
  const parsed = CreateOrderSchema.parse(req.body);
  const currentOrgId = req.membership!.organizationId;
  const currentOrgType = req.membership!.type;

  if (currentOrgType === 'PARTNER' && parsed.type !== 'REQUEST') {
    throw new ApiError(403, 'Partners can request kiosks but cannot allocate them');
  }
  if (currentOrgType === 'COMPANY' && parsed.type === 'REQUEST') {
    throw new ApiError(403, 'Company cannot request kiosks; use ALLOCATION to push kiosks to distributors or partners');
  }

  let parentOrgId: string;
  let childOrgId: string;
  let requestSupplierId: string | null = null;

  if (parsed.type === 'REQUEST') {
    childOrgId = currentOrgId;
    const supplierAgreement = await prisma.$transaction((tx) =>
      requireImmediateSupplier(tx, childOrgId, currentOrgType),
    );
    parentOrgId = supplierAgreement.parentOrg.id;
    requestSupplierId = parentOrgId;
  } else {
    // ALLOCATION: Company or Distributor pushes kiosks down to a child org.
    parentOrgId = currentOrgId;
    childOrgId = parsed.targetOrgId;
  }

  const order = await prisma.$transaction(async (tx) => {
    const candidate = await tx.agreement.findFirst({
      where: { parentOrgId, childOrgId, status: 'ACTIVE' },
    });
    if (!candidate)
      throw new ApiError(
        403,
        'Cannot create order: No active agreement exists between these organizations',
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
    if (agreement.status !== 'ACTIVE')
      throw new ApiError(403, 'Agreement is no longer active');
    if (parsed.type === "REQUEST") {
      await assertRequestModelAvailable(
        tx,
        requestSupplierId!,
        parsed.model,
        parsed.quantity,
      );
    }
    const year = new Date().getFullYear();
    const sequence = await tx.$queryRaw<
      [{ value: number }]
    >`INSERT INTO "OrderSequence" (year,value) VALUES (${year},1) ON CONFLICT (year) DO UPDATE SET value="OrderSequence".value+1 RETURNING value`;
    const depositPerMachine = agreement.depositAmountPerMachine;
    const nonRefundablePerMachine = agreement.nonRefundableAmountPerMachine;
    const totalDeposit = depositPerMachine * parsed.quantity;
    const totalNonRefundable = nonRefundablePerMachine * parsed.quantity;
    // GST is configuration, not a constant: read the shared rate so a change in
    // System Settings applies to new orders without a code change. Falls back to
    // the schema default (18%) if the settings row is absent.
    const settings = await tx.systemSettings.findUnique({
      where: { id: 'default' },
    });
    const gstRate = settings ? Number(settings.gstPercentage) / 100 : 0.18;
    const taxAmount = Math.round(totalNonRefundable * gstRate * 100) / 100;
    const row = await tx.order.create({
      data: {
        orderNumber: `ORD-${year}-${String(sequence[0].value).padStart(5, '0')}`,
        type: parsed.type,
        status: parsed.type === 'REQUEST' ? 'UNDER_REVIEW' : 'APPROVED',
        parentOrgId,
        childOrgId,
        agreementId: agreement.id,
        quantity: parsed.quantity,
        requestedModel: parsed.type === "REQUEST" ? parsed.model : parsed.model ?? null,
        depositPerMachine,
        nonRefundablePerMachine,
        totalDeposit,
        totalNonRefundable,
        taxAmount,
        grandTotal: totalDeposit + totalNonRefundable + taxAmount,
      },
    });
    if (parsed.type === 'ALLOCATION') {
      await reserveKiosks(tx, parentOrgId, parsed.quantity, row.id, parsed.model);
      await queueInvoice(tx, parentOrgId, row.id);
    }
    return row;
  });

  if (parsed.type === 'REQUEST')
    return res
      .status(201)
      .json(
        new ApiResponse(
          201,
          { order },
          'Order requested successfully. Pending approval.',
        ),
      );

  const invoiceEmailSent = await attemptDelivery(invoiceDeliveryKey(order.id));
  const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  res.status(201).json(
    new ApiResponse(
      201,
      { order: updated, invoiceEmailSent, invoiceReady: !!updated.invoiceFilename },
      'Order created; invoice delivery queued',
    ),
  );
});

export const approveOrder = asyncHandler(async (req, res) => {
  await requireWorkflow('orderDecisions');
  const id = req.params.orderId;
  if (typeof id !== "string") throw new ApiError(400, "Invalid order ID");
  await prisma.$transaction(async (tx) => {
    const order = await lockedOrder(tx, id, req.membership!.organizationId);
    if (order.status !== "UNDER_REVIEW")
      throw new ApiError(
        400,
        `Cannot approve an order that is currently ${order.status}`,
      );
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${order.parentOrgId} FOR UPDATE`;
    await reserveKiosks(tx, order.parentOrgId, order.quantity, id, order.requestedModel ?? undefined);
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

// Rejection precedes approval; it never cancels stock or payment commitments.
export const rejectOrder = asyncHandler(async (req, res) => {
  await requireWorkflow('orderDecisions');
  const { orderId } = OrderParamsSchema.parse(req.params);
  const order = await prisma.$transaction(async tx => {
    const current = await lockedOrder(tx, orderId, req.membership!.organizationId);
    if (current.type !== 'REQUEST' || current.status !== 'UNDER_REVIEW' || current.paymentStatus !== 'PENDING')
      throw new ApiError(409, 'Only an unpaid request under review can be rejected');
    if (current.dispatchedKiosks.length ||
      await tx.kiosk.count({ where: { reservedOrderId: orderId } }) ||
      await tx.kioskAssignment.count({ where: { orderId } }))
      throw new ApiError(409, 'This request has inventory history and requires reconciliation');
    return tx.order.update({ where: { id: orderId }, data: { status: 'REJECTED' } });
  });
  res.json(new ApiResponse(200, { order }, 'Order request rejected; inventory unchanged'));
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
  // Parsed before the transaction opens: a missing location must fail without touching
  // stock, so the order keeps its DISPATCHED state and nothing is transferred.
  const { location } = DeliverOrderSchema.parse(req.body);
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
        // The site the kiosks were delivered to. This is the only place a delivery
        // location is recorded, so the validated value is written onto every kiosk in
        // the same transaction that transfers ownership.
        location,
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
    select: {
      parentOrgId: true, childOrgId: true,
      orderNumber: true, createdAt: true, quantity: true,
      depositPerMachine: true, nonRefundablePerMachine: true,
      totalDeposit: true, totalNonRefundable: true, taxAmount: true, grandTotal: true,
      parentOrg: { select: { name: true } },
      childOrg: { select: { name: true } },
      dispatchedKiosks: {
        select: {
          kiosk: { select: { machineCode: true, model: true } },
        },
        orderBy: { kioskId: "asc" },
      },
    },
  });
  if (!order) throw new ApiError(404, "Order not found");
  if (
    ![order.parentOrgId, order.childOrgId].includes(
      req.membership!.organizationId,
    )
  )
    throw new ApiError(403, "Unauthorized to access this invoice");
  // Render from the immutable order snapshot on every request. This keeps downloads
  // available on Vercel, where /tmp is ephemeral and generated invoice files do not
  // survive across invocations or instances.
  const pdf = await renderInvoicePDF({
    ...order,
    parentOrgName: order.parentOrg.name,
    childOrgName: order.childOrg.name,
    date: order.createdAt,
    kiosks: order.dispatchedKiosks.map(({ kiosk }) => kiosk),
  });
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${order.orderNumber}.pdf"`,
  );
  res.send(pdf);
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
      parentOrg: { select: { id: true, name: true, type: true } },
      childOrg: { select: { id: true, name: true, type: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res
    .status(200)
    .json(
      new ApiResponse(200, { orders }, "Order requests fetched successfully"),
    );
});

export const getOrderDetails = asyncHandler(async (req, res) => {
  const { orderId } = OrderParamsSchema.parse(req.params);
  const organizationId = req.membership!.organizationId;
  // Order parties remain the historical participants after kiosks change owners.
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      OR: [{ parentOrgId: organizationId }, { childOrgId: organizationId }],
    },
    include: {
      parentOrg: { select: { id: true, name: true, type: true } },
      childOrg: { select: { id: true, name: true, type: true } },
      dispatchedKiosks: {
        select: {
          kiosk: { select: { id: true, machineCode: true, model: true, status: true } },
        },
        orderBy: { kioskId: "asc" },
      },
    },
  });
  if (!order) throw new ApiError(404, "Order not found");
  res.status(200).json(new ApiResponse(200, { order }, "Order details fetched successfully"));
});
