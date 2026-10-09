import type { Request, Response } from "express";
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

// Display-only organization references; do not expose contact or invite details.
const kioskDisplaySelect = {
  id: true,
  machineCode: true,
  model: true,
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

  // Company sees all machines (or can filter). Distributors/Partners strictly see their current inventory.
  const query = orgType === "COMPANY" ? {} : { currentOrgId };

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

    // Group by status to generate the dashboard counters
    const summary = await prisma.kiosk.groupBy({
      by: ["status"],
      where: { currentOrgId },
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
