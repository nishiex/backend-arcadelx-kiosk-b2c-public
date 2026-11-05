import type { Request, Response } from "express";
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../utils/db";
import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { asyncHandler } from "../../utils/asyncHandler";
import { BatchCreateKiosksSchema } from "@shared-types/validationSchemas/Kiosk/kiosk.validation";
import { recordOpeningAssignmentsByCode } from "../../services/kiosk-ownership";

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

    res.status(201).json(new ApiResponse(201,
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


export const getKiosks = asyncHandler(
  async (req: Request, res: Response) => {
    const currentOrgId = req.membership!.organizationId;
    const orgType = req.membership!.type;

    const requestedOrgId = typeof req.query.organizationId === "string"? req.query.organizationId: currentOrgId;

    let allowedOrgIds: string[] = [];

    if (orgType === "COMPANY") {
      // Find direct Distributors.
      const distributors = await prisma.organization.findMany({
        where: {
          parentOrgId: currentOrgId,
          type: "DISTRIBUTOR",
        },
        select: { id: true },
      });

      const distributorIds = distributors.map((d) => d.id);

      // Find direct Partners and Partners under Distributors.
      const partners = await prisma.organization.findMany({
        where: {
          type: "PARTNER",
          parentOrgId: {
            in: [currentOrgId, ...distributorIds],
          },
        },
        select: { id: true },
      });

      allowedOrgIds = [currentOrgId, ...distributorIds, ...partners.map((p) => p.id),];
    } else if (orgType === "DISTRIBUTOR") {
      // Find direct Partners.
      const partners = await prisma.organization.findMany({
        where: {
          parentOrgId: currentOrgId,
          type: "PARTNER",
        },
        select: { id: true },
      });

      allowedOrgIds = [ currentOrgId, ...partners.map((p) => p.id),];
    } else if (orgType === "PARTNER") {
      // Partners can only view their own inventory.
      allowedOrgIds = [currentOrgId];
    }

    // Validate requested organization access.
    if (!allowedOrgIds.includes(requestedOrgId)) throw new ApiError(403,"Unauthorized to view this organization's kiosks");
    
    // Fetch kiosks currently owned by the selected organization.
    const kiosks = await prisma.kiosk.findMany({
      where: {
        currentOrgId: requestedOrgId,
      },
      select: kioskDisplaySelect,
      orderBy: {
        createdAt: "desc",
      },
    });

    // Format inventory response.
    const inventory = kiosks.map(({ assignments, ...kiosk }) => ({
      ...kiosk,
      assignedOrg: assignments[0]?.organization ?? null,
    }));

    res.status(200).json(new ApiResponse(200,
        { kiosks: inventory },"Inventory fetched successfully",
      ),
    );
  },
);


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

    res.status(200).json(new ApiResponse(200,{
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


/** Deactivate machines while preserving ownership, assignment history, and kiosk data. */

export const deactivateKiosks = asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, kioskIds } = req.body;

    const sourceOrgId = req.membership!.organizationId;
    const sourceType = req.membership!.type;

    if (!["COMPANY", "DISTRIBUTOR"].includes(sourceType)) throw new ApiError(403,"Only Companies and Distributors can deactivate kiosks",);
    

    const result = await prisma.$transaction(async (tx) => {
      let allowedOrganizationIds: string[] = [];

      if (sourceType === "COMPANY") {
        // Company has root access to its entire organization network.
        const distributors = await tx.organization.findMany({
          where: {
            parentOrgId: sourceOrgId,
            type: "DISTRIBUTOR",
          },
          select: { id: true },
        });

        const distributorIds = distributors.map((org) => org.id);

        const partners = await tx.organization.findMany({
          where: {
            type: "PARTNER",
            parentOrgId: {
              in: [sourceOrgId, ...distributorIds],
            },
          },
          select: { id: true },
        });

        allowedOrganizationIds = [sourceOrgId,...distributorIds,...partners.map((org) => org.id)];
      } else {
        // Distributor can manage only itself and its direct Partners.
        const partners = await tx.organization.findMany({
          where: {
            parentOrgId: sourceOrgId,
            type: "PARTNER",
          },
          select: { id: true },
        });
        allowedOrganizationIds = [sourceOrgId, ...partners.map((org) => org.id),];
      }

      // Verify that the requested target belongs to the allowed network.
      if (!allowedOrganizationIds.includes(organizationId)) throw new ApiError(403,"You are not authorized to deactivate kiosks belonging to this organization",);

      // Ensure the target organization is active.
      const target = await tx.organization.findFirst({
        where: {
          id: organizationId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          type: true,
        },
      });

      if (!target) throw new ApiError(404, "Target organization not found or inactive");

      // Lock selected kiosks.to avoid concurrent Deactivation
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id
        FROM "Kiosk"
        WHERE id IN (${Prisma.join(kioskIds)})
        FOR UPDATE
      `;

      if (locked.length !== kioskIds.length) throw new ApiError(409,"One or more selected kiosks cannot be deactivated");

      // Fetch eligible kiosks.
      const kiosks = await tx.kiosk.findMany({
        where: {
          id: { in: kioskIds },
          currentOrgId: target.id,
          status: {
            in: ["AVAILABLE","RETURNED","MAINTENANCE","INSTALLED",],
          },
          reservedOrderId: null,
        },
        select: {
          id: true,
          machineCode: true,
          model: true,
        },
      });

      if (kiosks.length !== kioskIds.length) throw new ApiError(409,"One or more selected kiosks are unavailable or cannot be deactivated",);
      

      // Retire kiosks without deleting ownership or transaction history.
      await tx.kiosk.updateMany({
        where: {
          id: { in: kioskIds },
          currentOrgId: target.id,
          status: {
            in: ["AVAILABLE","RETURNED","MAINTENANCE","INSTALLED",],
          },
          reservedOrderId: null,
        },
        data: {
          status: "RETIRED",
        },
      });

      return {kiosks,organization: target};
    });

    res.status(200).json(new ApiResponse(200,result,"Kiosks deactivated successfully",));
  },
);

export const getInventorySummary = asyncHandler(async (req: Request, res: Response) => {
    const currentOrgId = req.membership!.organizationId;
    const orgType = req.membership!.type;

    // Company dashboards match the Kiosks page and cover the whole company fleet.
    // A Distributor's fleet is the machines it still holds plus the ones it has placed
    // with its Partners: counting only its own inventory hid every installed kiosk.
    let scope: Prisma.KioskWhereInput = { currentOrgId };
    if (orgType === "COMPANY") {
      scope = {};
    } else if (orgType === "DISTRIBUTOR") {
      const partners = await prisma.organization.findMany({
        where: { parentOrgId: currentOrgId, type: "PARTNER" },
        select: { id: true },
      });
      scope = { currentOrgId: { in: [currentOrgId, ...partners.map((partner) => partner.id)] } };
    }
    const summary = await prisma.kiosk.groupBy({
      by: ["status"],
      where: scope,
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

    res.status(200).json(new ApiResponse(200,{ summary: formattedSummary },"Inventory summary fetched",),);
  },
);
