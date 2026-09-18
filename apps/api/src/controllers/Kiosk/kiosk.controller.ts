import type { Request, Response } from 'express';
import { prisma } from '../../utils/db';
import { ApiError } from '../../utils/ApiError';
import { ApiResponse } from '../../utils/ApiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { BatchCreateKiosksSchema, UpdateKioskStatusSchema } from '@shared-types/validationSchemas/Kiosk/kiosk.validation';

// Helper to format ADLX-2026-A001
function formatMachineCode(sequenceNumber: number, year: number): string {
  const MAX_PER_LETTER = 999;
  const letterIndex = Math.floor((sequenceNumber - 1) / MAX_PER_LETTER);
  const numberPart = ((sequenceNumber - 1) % MAX_PER_LETTER) + 1;

  if (letterIndex > 25) {
    throw new Error('Yearly machine code capacity exceeded (25,974 max)');
  }

  const letter = String.fromCharCode(65 + letterIndex); // 65 is ASCII 'A'
  const paddedNumber = numberPart.toString().padStart(3, '0');

  return `ADLX-${year}-${letter}${paddedNumber}`;
}

export const batchCreateKiosks = asyncHandler(async (req: Request, res: Response) => {
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

  const kiosksToInsert = [];
  for (let i = startValue; i <= endValue; i++) {
    kiosksToInsert.push({
      machineCode: formatMachineCode(i, currentYear),
      model,
      status: 'AVAILABLE' as const,
      currentOrgId
    });
  }

  await prisma.kiosk.createMany({
    data: kiosksToInsert
  });

  res.status(201).json(new ApiResponse(201, { count, startCode: kiosksToInsert[0]!.machineCode, endCode: kiosksToInsert[kiosksToInsert.length - 1]!.machineCode }, 'Kiosks batch created successfully'));
});

export const getKiosks = asyncHandler(async (req: Request, res: Response) => {
  const currentOrgId = req.membership!.organizationId;
  const orgType = req.membership!.type;

  // Company sees all machines (or can filter). Distributors/Partners strictly see their current inventory.
  const query = orgType === 'COMPANY' ? {} : { currentOrgId };

  const kiosks = await prisma.kiosk.findMany({
    where: query,
    select: {
      id: true,
      machineCode: true,
      model: true,
      status: true,
      location: true,
      currentOrgId: true
      // externalDeviceId is explicitly omitted from the select payload
    },
    orderBy: { createdAt: 'desc' }
  });

  res.status(200).json(new ApiResponse(200, { kiosks }, 'Inventory fetched successfully'));
});

export const getKioskById = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const currentOrgId = req.membership!.organizationId;
  const orgType = req.membership!.type;

  if(typeof id !=="string")throw new ApiError(400,"Enter a valid Id")

  const kiosk = await prisma.kiosk.findUnique({
    where: { id },
    select: {
      id: true,
      machineCode: true,
      model: true,
      status: true,
      location: true,
      currentOrgId: true
    }
  });

  if (!kiosk) throw new ApiError(404, 'Kiosk not found');

  // Authorization wall: Prevent Dist/Partner from viewing other orgs' machines via direct URL
  if (orgType !== 'COMPANY' && kiosk.currentOrgId !== currentOrgId) {
    throw new ApiError(403, 'Unauthorized to view this machine');
  }

  res.status(200).json(new ApiResponse(200, { kiosk }, 'Kiosk fetched successfully'));
});

export const updateKioskStatus = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, location } = UpdateKioskStatusSchema.parse(req.body);
  const currentOrgId = req.membership!.organizationId;
  const orgType = req.membership!.type;

  if(typeof id !=="string")throw new ApiError(400,"Enter a valid Id")

  const kiosk = await prisma.kiosk.findUnique({ where: { id } });
  if (!kiosk) throw new ApiError(404, 'Kiosk not found');

  if (orgType !== 'COMPANY' && kiosk.currentOrgId !== currentOrgId) {
    throw new ApiError(403, 'Unauthorized to modify this machine');
  }

  // Business Logic: Location is mandatory when installing
  if (status === 'INSTALLED' && !location && !kiosk.location) {
    throw new ApiError(400, 'Location must be provided when setting status to INSTALLED');
  }
  
  const updatedKiosk = await prisma.kiosk.update({
    where: { id },
    data: {
      status,
      // If setting to available/maintenance from installed, you might want to retain or clear location.
      // Here we only update if provided, but clear it if physically returned to warehouse.
      location: (status === 'RETURNED' || status === 'AVAILABLE') ? null : (location || kiosk.location)
    },
    select: {
      id: true,
      machineCode: true,
      status: true,
      location: true
    }
  });

  res.status(200).json(new ApiResponse(200, { kiosk: updatedKiosk }, 'Kiosk status updated successfully'));
});

export const getInventorySummary = asyncHandler(async (req: Request, res: Response) => {
  const currentOrgId = req.membership!.organizationId;

  // Group by status to generate the dashboard counters
  const summary = await prisma.kiosk.groupBy({
    by: ['status'],
    where: { currentOrgId },
    _count: {
      status: true
    }
  });

  // Transform Prisma's group payload into a clean object: { AVAILABLE: 50, INSTALLED: 12 }
  const formattedSummary = summary.reduce((acc, curr) => {
    acc[curr.status] = curr._count.status;
    return acc;
  }, {} as Record<string, number>);

  res.status(200).json(new ApiResponse(200, { summary: formattedSummary }, 'Inventory summary fetched'));
});