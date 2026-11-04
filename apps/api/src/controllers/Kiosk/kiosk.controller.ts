import type { Request, Response } from "express";
import { z } from "zod";
import type { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../utils/db";
import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import {
  BatchCreateKiosksSchema,
  UpdateKioskStatusSchema,
} from "@shared-types/validationSchemas/Kiosk/kiosk.validation";
import { recordOpeningAssignmentsByCode } from "../../services/kiosk-ownership";

const AssignKiosksSchema = z.object({
  organizationId: z.string().uuid(),
  kioskIds: z.array(z.string().uuid()).min(1).max(200),
});

let retiredStatusReady: Promise<void> | null = null;
function ensureRetiredKioskStatus() {
  retiredStatusReady ??= prisma.$executeRawUnsafe(`ALTER TYPE "KioskStatus" ADD VALUE IF NOT EXISTS 'RETIRED'`).then(() => undefined);
  return retiredStatusReady;
}

// Display-only organization references; do not expose contact or invite details.
const kioskDisplaySelect = {
  id: true,
  machineCode: true,
  model: true,
  externalDeviceId: true,
  status: true,
  location: true,
  currentOrgId: true,
  currentOrg: { select: { id: true, name: true, type: true } },
  assignments: {
    where: { assignedTo: null },
    orderBy: [{ assignedFrom: "desc" }, { id: "desc" }],
    take: 1,
    select: {
      organization: { select: { id: true, name: true, type: true } },
    },
  },
} satisfies Prisma.KioskSelect;

// Helper to format ADLX-2026-A001
function formatMachineCode(sequenceNumber: number, year: number): string {
  const MAX_PER_LETTER = 999;
  const letterIndex = Math.floor((sequenceNumber - 1) / MAX_PER_LETTER);
  const numberPart = ((sequenceNumber - 1) % MAX_PER_LETTER) + 1;

  if (letterIndex > 25) {
    throw new Error("Yearly machine code capacity exceeded (25,974 max)");
  }

  const letter = String.fromCharCode(65 + letterIndex); // 65 is ASCII 'A'
  const paddedNumber = numberPart.toString().padStart(3, "0");

  return `ADLX-${year}-${letter}${paddedNumber}`;
}

export const batchCreateKiosks = asyncHandler(
  async (req: Request, res: Response) => {
    const { count, model } = BatchCreateKiosksSchema.parse(req.body);
    const currentOrgId = req.membership!.organizationId;
    const currentYear = new Date().getFullYear();

    // Atomic UPSERT lock: safely increments the sequence for the current year
    // returns the final counter value after adding `count`.
    const seqResult = await prisma.$queryRaw<[{ value: number }]>`
    INSERT INTO "MachineSequence" (year, value) 
    VALUES (${currentYear}, ${count})
    ON CONFLICT (year) 
    DO UPDATE SET value = "MachineSequence".value + ${count}
    RETURNING value;
  `;

    const endValue = seqResult[0].value;
    const startValue = endValue - count + 1;

    const kiosksToInsert: Array<{ machineCode: string; model: string; status: "AVAILABLE"; currentOrgId: string }> = [];
    for (let i = startValue; i <= endValue; i++) {
      kiosksToInsert.push({
        machineCode: formatMachineCode(i, currentYear),
        model,
        status: "AVAILABLE" as const,
        currentOrgId,
      });
    }

    // Registration and its opening ownership ledger commit together, so a created
    // machine can never be missing the assignment that revenue attribution reads.
    await prisma.$transaction(async (tx) => {
      await tx.kiosk.createMany({ data: kiosksToInsert });
      await recordOpeningAssignmentsByCode(
        tx,
        kiosksToInsert.map(kiosk => kiosk.machineCode),
        req.user?.id ?? null,
      );
    });

    res
      .status(201)
      .json(
        new ApiResponse(
          201,
          {
            count,
            startCode: kiosksToInsert[0]!.machineCode,
            endCode: kiosksToInsert[kiosksToInsert.length - 1]!.machineCode,
          },
          "Kiosks batch created successfully",
        ),
      );
  },
);

export const getKiosks = asyncHandler(async (req: Request, res: Response) => {
  const currentOrgId = req.membership!.organizationId;
  const orgType = req.membership!.type;

  // Company sees all machines. Distributors see their own inventory plus direct Partners'
  // inventory so they can review what was transferred down their network.
  let query: Prisma.KioskWhereInput = { currentOrgId };
  if (orgType === "COMPANY") {
    query = {};
  } else if (orgType === "DISTRIBUTOR") {
    const partners = await prisma.organization.findMany({
      where: { parentOrgId: currentOrgId, type: "PARTNER", isActive: true },
      select: { id: true },
    });
    query = { currentOrgId: { in: [currentOrgId, ...partners.map(partner => partner.id)] } };
  }

  const kiosks = await prisma.kiosk.findMany({
    where: query,
    select: kioskDisplaySelect,
    orderBy: { createdAt: "desc" },
  });
  const inventory = kiosks.map(({ assignments, ...kiosk }) => ({
    ...kiosk,
    assignedOrg: assignments[0]?.organization ?? null,
  }));

  res
    .status(200)
    .json(
      new ApiResponse(200, { kiosks: inventory }, "Inventory fetched successfully"),
    );
});

export const getKioskById = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const currentOrgId = req.membership!.organizationId;
    const orgType = req.membership!.type;

    if (typeof id !== "string") throw new ApiError(400, "Enter a valid Id");

    const kiosk = await prisma.kiosk.findUnique({
      where: { id },
      select: kioskDisplaySelect,
    });

    if (!kiosk) throw new ApiError(404, "Kiosk not found");

    // Authorization wall: Prevent Dist/Partner from viewing other orgs' machines via direct URL
    if (orgType !== "COMPANY" && kiosk.currentOrgId !== currentOrgId) {
      throw new ApiError(403, "Unauthorized to view this machine");
    }
    const { assignments, ...details } = kiosk;

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          {
            kiosk: {
              ...details,
              assignedOrg: assignments[0]?.organization ?? null,
            },
          },
          "Kiosk fetched successfully",
        ),
      );
  },
);

/** Transfer available machines from the acting organization to its direct child. */
export const assignKiosks = asyncHandler(async (req: Request, res: Response) => {
  const { organizationId, kioskIds } = AssignKiosksSchema.parse(req.body);
  const sourceOrgId = req.membership!.organizationId;
  const sourceType = req.membership!.type;

  if (!["COMPANY", "DISTRIBUTOR"].includes(sourceType)) {
    throw new ApiError(403, "Only Master Admins and Distributors can assign kiosks");
  }

  const target = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, type: true, parentOrgId: true, isActive: true },
  });
  if (!target || !target.isActive) throw new ApiError(404, "Target organization not found");

  const expectedTargetType = sourceType === "COMPANY" ? "DISTRIBUTOR" : "PARTNER";
  if (target.type !== expectedTargetType || target.parentOrgId !== sourceOrgId) {
    throw new ApiError(403, "Kiosks can only be assigned to your direct network children");
  }

  const assigned = await prisma.$transaction(async (tx) => {
    const kiosks = await tx.kiosk.findMany({
      where: {
        id: { in: kioskIds },
        currentOrgId: sourceOrgId,
        externalDeviceId: { not: null },
        status: { in: ["AVAILABLE", "RETURNED", "MAINTENANCE"] },
        reservedOrderId: null,
      },
      select: { id: true, machineCode: true, model: true },
    });
    if (kiosks.length !== kioskIds.length) {
      // Name the unpaired machines explicitly: "unavailable or unpaired" left operators
      // guessing whether the machine is in the wrong state or simply has no hardware yet.
      const eligible = new Set(kiosks.map((kiosk) => kiosk.id));
      const unpaired = await tx.kiosk.findMany({
        where: {
          id: { in: kioskIds.filter((id) => !eligible.has(id)) },
          currentOrgId: sourceOrgId,
          externalDeviceId: null,
        },
        select: { machineCode: true },
      });
      if (unpaired.length > 0) {
        throw new ApiError(
          409,
          `Pair the machine to hardware before assigning it: ${unpaired.map((kiosk) => kiosk.machineCode).join(", ")}`,
        );
      }
      throw new ApiError(409, "One or more selected kiosks are unavailable or unpaired");
    }

    const now = new Date();
    await tx.kioskAssignment.updateMany({
      where: { kioskId: { in: kioskIds }, assignedTo: null },
      data: { assignedTo: now },
    });
    await tx.kioskAssignment.createMany({
      data: kioskIds.map(kioskId => ({
        kioskId,
        organizationId,
        assignedById: req.user!.id,
      })),
    });
    await tx.kiosk.updateMany({
      where: { id: { in: kioskIds } },
      data: { currentOrgId: organizationId, status: "AVAILABLE", reservedOrderId: null },
    });
    return kiosks;
  });

  res.status(200).json(new ApiResponse(200, { kiosks: assigned, organization: target }, "Kiosks assigned successfully"));
});

/** Deactivate machines while preserving ownership, assignment history, and kiosk data. */
export const deactivateKiosks = asyncHandler(async (req: Request, res: Response) => {
  const { organizationId, kioskIds } = AssignKiosksSchema.parse(req.body);
  const sourceOrgId = req.membership!.organizationId;
  const sourceType = req.membership!.type;

  if (!["COMPANY", "DISTRIBUTOR"].includes(sourceType)) {
    throw new ApiError(403, "Only Master Admins and Distributors can deactivate kiosks");
  }

  const target = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, type: true, parentOrgId: true, isActive: true },
  });
  const expectedTargetType = sourceType === "COMPANY" ? "DISTRIBUTOR" : "PARTNER";
  if (!target || !target.isActive || target.type !== expectedTargetType || target.parentOrgId !== sourceOrgId) {
    throw new ApiError(403, "Kiosks can only be deactivated for your direct network children");
  }

  await ensureRetiredKioskStatus();

  const returned = await prisma.$transaction(async (tx) => {
    const kiosks = await tx.kiosk.findMany({
      where: {
        id: { in: kioskIds },
        currentOrgId: organizationId,
        status: { in: ["AVAILABLE", "RETURNED", "MAINTENANCE"] },
        reservedOrderId: null,
      },
      select: { id: true, machineCode: true, model: true },
    });
    if (kiosks.length !== kioskIds.length) {
      throw new ApiError(409, "One or more selected kiosks cannot be deactivated");
    }

    await tx.kiosk.updateMany({
      where: { id: { in: kioskIds } },
      data: { status: "RETIRED" },
    });
    return kiosks;
  });

  res.status(200).json(new ApiResponse(200, { kiosks: returned, organization: target }, "Kiosks deactivated successfully"));
});

/** Deactivate a kiosk in a Distributor/Partner inventory without deleting its history. */
export const removeKiosk = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const organizationId = req.membership!.organizationId;
  const organizationType = req.membership!.type;
  if (typeof id !== "string") throw new ApiError(400, "Enter a valid Id");
  if (!["COMPANY", "DISTRIBUTOR", "PARTNER"].includes(organizationType)) {
    throw new ApiError(403, "Only organization admins can remove kiosks from inventory");
  }

  await ensureRetiredKioskStatus();

  const kiosk = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Kiosk" WHERE id=${id} FOR UPDATE`;
    const current = await tx.kiosk.findUnique({ where: { id } });
    if (!current || current.currentOrgId !== organizationId) {
      throw new ApiError(404, "Kiosk not found in your inventory");
    }
    if (current.reservedOrderId || ["RESERVED", "ASSIGNED", "RETIRED"].includes(current.status)) {
      throw new ApiError(409, "Reserved, in-transit, and retired kiosks cannot be deactivated");
    }

    return tx.kiosk.update({
      where: { id },
      data: { status: "RETIRED" },
      select: { id: true, machineCode: true, status: true, currentOrgId: true },
    });
  });

  res.status(200).json(new ApiResponse(200, { kiosk }, "Kiosk deactivated successfully"));
});

const returnableKioskStatuses = ["AVAILABLE", "RETURNED", "MAINTENANCE"] as const;

/** Request that a kiosk be returned to its direct supplier organization. */
export const requestKioskReturn = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const organizationId = req.membership!.organizationId;
  const organizationType = req.membership!.type;
  if (typeof id !== "string") throw new ApiError(400, "Enter a valid Id");
  if (!["DISTRIBUTOR", "PARTNER"].includes(organizationType)) {
    throw new ApiError(403, "Only Distributors and Partners can request kiosk removal");
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Kiosk" WHERE id=${id} FOR UPDATE`;
    const kiosk = await tx.kiosk.findUnique({ where: { id } });
    if (!kiosk || kiosk.currentOrgId !== organizationId) {
      throw new ApiError(404, "Kiosk not found in your inventory");
    }
    if (kiosk.reservedOrderId || !returnableKioskStatuses.includes(kiosk.status as typeof returnableKioskStatuses[number])) {
      throw new ApiError(409, "This kiosk cannot be requested for removal in its current state");
    }
    const existing = await tx.kioskReturnRequest.findFirst({
      where: { kioskId: id, status: "PENDING" },
      select: { id: true },
    });
    if (existing) throw new ApiError(409, "A removal request is already pending for this kiosk");

    return tx.kioskReturnRequest.create({
      data: { kioskId: id, organizationId, requestedById: req.user!.id },
      select: { id: true, kioskId: true, organizationId: true, status: true, createdAt: true },
    });
  });

  res.status(201).json(new ApiResponse(201, { request: result }, "Kiosk removal request submitted"));
});

/** List pending return requests visible to the acting organization. */
export const getKioskReturnRequests = asyncHandler(async (req: Request, res: Response) => {
  const organizationId = req.membership!.organizationId;
  const organizationType = req.membership!.type;
  const where: Prisma.KioskReturnRequestWhereInput = organizationType === "COMPANY"
    ? { status: "PENDING", organization: { type: "DISTRIBUTOR", parentOrgId: organizationId } }
    : organizationType === "DISTRIBUTOR"
      ? { status: "PENDING", organization: { parentOrgId: organizationId } }
      : { organizationId, status: "PENDING" };

  const requests = await prisma.kioskReturnRequest.findMany({
    where,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      kioskId: true,
      organizationId: true,
      status: true,
      createdAt: true,
      kiosk: { select: { machineCode: true, model: true, status: true, currentOrgId: true } },
      organization: { select: { id: true, name: true, type: true, parentOrgId: true } },
      requestedBy: { select: { id: true, name: true, email: true } },
    },
  });
  res.status(200).json(new ApiResponse(200, { requests }, "Kiosk removal requests fetched successfully"));
});

/** Approve a return request and transfer the kiosk back to the direct supplier. */
export const approveKioskReturn = asyncHandler(async (req: Request, res: Response) => {
  const { requestId } = req.params;
  if (typeof requestId !== "string") throw new ApiError(400, "Enter a valid request Id");
  const actingOrgId = req.membership!.organizationId;
  const actingType = req.membership!.type;
  if (!["COMPANY", "DISTRIBUTOR"].includes(actingType)) {
    throw new ApiError(403, "Only Company or Distributor admins can approve kiosk removal requests");
  }

  const approved = await prisma.$transaction(async (tx) => {
    const request = await tx.kioskReturnRequest.findUnique({
      where: { id: requestId },
      include: { organization: { select: { id: true, type: true, parentOrgId: true } } },
    });
    if (!request || request.status !== "PENDING") throw new ApiError(404, "Pending kiosk removal request not found");
    if (request.organization.parentOrgId !== actingOrgId) {
      throw new ApiError(403, "This kiosk removal request is outside your direct network");
    }
    if (actingType === "COMPANY" && request.organization.type !== "DISTRIBUTOR") {
      throw new ApiError(403, "Company admins can approve Distributor kiosk returns only");
    }
    if (actingType === "DISTRIBUTOR" && request.organization.type !== "PARTNER") {
      throw new ApiError(403, "Distributor admins can approve Partner kiosk returns only");
    }

    await tx.$queryRaw`SELECT id FROM "Kiosk" WHERE id=${request.kioskId} FOR UPDATE`;
    const kiosk = await tx.kiosk.findUnique({ where: { id: request.kioskId } });
    if (!kiosk || kiosk.currentOrgId !== request.organizationId || kiosk.reservedOrderId) {
      throw new ApiError(409, "The kiosk is no longer eligible for return");
    }

    const returnedToOrgId = request.organization.parentOrgId!;
    const now = new Date();
    await tx.kioskAssignment.updateMany({ where: { kioskId: kiosk.id, assignedTo: null }, data: { assignedTo: now } });
    await tx.kioskAssignment.create({ data: { kioskId: kiosk.id, organizationId: returnedToOrgId, assignedById: req.user!.id } });
    await tx.kiosk.update({ where: { id: kiosk.id }, data: { currentOrgId: returnedToOrgId, status: "RETURNED", reservedOrderId: null } });
    return tx.kioskReturnRequest.update({ where: { id: request.id }, data: { status: "APPROVED" }, select: { id: true, kioskId: true, organizationId: true, status: true, updatedAt: true } });
  });

  res.status(200).json(new ApiResponse(200, { request: approved }, "Kiosk removal request approved"));
});

export const updateKioskStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, location } = UpdateKioskStatusSchema.parse(req.body);
    const currentOrgId = req.membership!.organizationId;
    const orgType = req.membership!.type;

    if (typeof id !== "string") throw new ApiError(400, "Enter a valid Id");

    const updatedKiosk = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Kiosk" WHERE id=${id} FOR UPDATE`;
      const kiosk = await tx.kiosk.findUnique({ where: { id } });
      if (!kiosk) throw new ApiError(404, "Kiosk not found");

      if (orgType !== "COMPANY" && kiosk.currentOrgId !== currentOrgId) {
        throw new ApiError(403, "Unauthorized to modify this machine");
      }

      if (
        kiosk.reservedOrderId ||
        ["RESERVED", "ASSIGNED"].includes(kiosk.status) ||
        ["RESERVED", "ASSIGNED"].includes(status)
      ) {
        throw new ApiError(
          409,
          "Reserved and in-transit kiosks can only change through their order",
        );
      }
      const transitions: Record<string, string[]> = {
        AVAILABLE: ["INSTALLED", "MAINTENANCE", "RETIRED"],
        INSTALLED: ["MAINTENANCE", "RETURNED"],
        MAINTENANCE: ["AVAILABLE", "INSTALLED", "RETURNED", "RETIRED"],
        RETURNED: ["AVAILABLE", "MAINTENANCE", "RETIRED"],
        RETIRED: [],
      };
      if (
        status !== kiosk.status &&
        !transitions[kiosk.status]?.includes(status)
      ) {
        throw new ApiError(
          409,
          `Cannot change kiosk status from ${kiosk.status} to ${status}`,
        );
      }

      // Business Logic: Location is mandatory when installing
      if (status === "INSTALLED" && !location && !kiosk.location) {
        throw new ApiError(
          400,
          "Location must be provided when setting status to INSTALLED",
        );
      }

      return tx.kiosk.update({
        where: { id },
        data: {
          status,
          // If setting to available/maintenance from installed, you might want to retain or clear location.
          // Here we only update if provided, but clear it if physically returned to warehouse.
          location:
            status === "RETURNED" || status === "AVAILABLE"
              ? null
              : location || kiosk.location,
        },
        select: {
          id: true,
          machineCode: true,
          status: true,
          location: true,
        },
      });
    });

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { kiosk: updatedKiosk },
          "Kiosk status updated successfully",
        ),
      );
  },
);

export const getInventorySummary = asyncHandler(
  async (req: Request, res: Response) => {
    const currentOrgId = req.membership!.organizationId;
    const orgType = req.membership!.type;

    // Company dashboards match the Kiosks page and cover the whole company fleet.
    // Distributor/Partner dashboards remain scoped to their current inventory.
    const summary = await prisma.kiosk.groupBy({
      by: ["status"],
      where: orgType === "COMPANY" ? {} : { currentOrgId },
      _count: {
        status: true,
      },
    });

    // Transform Prisma's group payload into a clean object: { AVAILABLE: 50, INSTALLED: 12 }
    const formattedSummary = summary.reduce(
      (acc, curr) => {
        acc[curr.status] = curr._count.status;
        return acc;
      },
      {} as Record<string, number>,
    );

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { summary: formattedSummary },
          "Inventory summary fetched",
        ),
      );
  },
);
