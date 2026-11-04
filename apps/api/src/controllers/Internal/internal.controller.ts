/*This file is written for connecting the Kiosk machine with out Business DB Uisng external Id and machine code 
External ID: -> uuid , generated on theserver in  The Mothership
machine Code -> Generated on both the side 
 */

import type { Request, Response } from 'express';
import { prisma } from '../../utils/db';
import { ApiError } from '../../utils/ApiError';
import { ApiResponse } from '../../utils/ApiResponse';
import { asyncHandler } from '../../utils/asyncHandler';
import { PairDeviceSchema } from '@shared-types/validationSchemas/Kiosk/kiosk.validation';
import { recordOpeningAssignments } from '../../services/kiosk-ownership';

export const getUnpairedKiosks = asyncHandler(async (req: Request, res: Response) => {
  // Fetch all machines that exist in the business DB but haven't been linked to hardware yet
  const unpairedKiosks = await prisma.kiosk.findMany({
    where: { externalDeviceId: null },
    select: {
      id: true,
      machineCode: true,
      model: true
    },
    orderBy: { machineCode: 'asc' }
  });

  res.status(200).json(new ApiResponse(200, { unpairedKiosks }, 'Unpaired kiosks fetched successfully'));
});

export const pairKioskDevice = asyncHandler(async (req: Request, res: Response) => {
  const { machineCode } = req.params;
  const { externalDeviceId } = PairDeviceSchema.parse(req.body);

  if(typeof machineCode !== "string")throw new ApiError(400,"Machine Code should be a string");

  const kiosk = await prisma.kiosk.findUnique({ where: { machineCode } });

  if (!kiosk) {
    throw new ApiError(404, `Machine code ${machineCode} does not exist in the business system`);
  }

  // Idempotency check: If Mothership already successfully paired this exact device but dropped the network response, 
  // we just return 200 OK so it doesn't get stuck in a retry loop.
  if (kiosk.externalDeviceId === externalDeviceId) {
    return res.status(200).json(new ApiResponse(200, { kiosk }, 'Device already paired successfully'));
  }

  // If the machine code is already paired to a DIFFERENT hardware device
  if (kiosk.externalDeviceId && kiosk.externalDeviceId !== externalDeviceId) {
    throw new ApiError(409, `Machine code ${machineCode} is already paired to a different hardware device`);
  }

  // Ensure this hardware UUID isn't already linked to another ADLX code
  const existingDevice = await prisma.kiosk.findUnique({ where: { externalDeviceId } });
  if (existingDevice) {
    throw new ApiError(409, `Hardware device ${externalDeviceId} is already paired to machine code ${existingDevice.machineCode}`);
  }

  const updatedKiosk = await prisma.$transaction(async (tx) => {
    const kiosk = await tx.kiosk.update({
      where: { machineCode },
      // Pairing is the point at which the hardware becomes operational, so the kiosk
      // moves to INSTALLED here (from the Backend branch). The ownership ledger below
      // is kept as well: it is what makes the kiosk's revenue attributable.
      data: { externalDeviceId, status: 'INSTALLED' },
      select: {
        id: true,
        machineCode: true,
        externalDeviceId: true,
        model: true,
        currentOrgId: true,
      }
    });
    // Pairing hardware is the point at which the device becomes operational, so it is
    // also when its ownership ledger starts (see kiosk-ownership.ts). Without this the
    // kiosk reports no revenue, because attribution only counts assigned windows.
    await recordOpeningAssignments(tx, [{ id: kiosk.id, currentOrgId: kiosk.currentOrgId }], req.user?.id ?? null);
    return kiosk;
  });

  res.status(200).json(new ApiResponse(200, {
    kiosk: { machineCode: updatedKiosk.machineCode, externalDeviceId: updatedKiosk.externalDeviceId, model: updatedKiosk.model },
  }, 'Hardware device paired successfully'));
});

/**
 * Release a machine code from its hardware. The mirror of pairing: pairing installs the
 * kiosk and opens an ownership window, so unpairing has to undo both, or the dashboard
 * keeps counting an installed machine and revenue keeps attributing a detached device.
 */
export const UnpairKioskDevice = asyncHandler(async (req: Request, res: Response) => {
  const machineCode = String(req.params.machineCode ?? "");
  const hardwareUUID = String(req.params.hardwareUUID ?? "");

  const kiosk = await prisma.kiosk.findUnique({ where: { machineCode } });
  if (!kiosk) throw new ApiError(404, `No kiosk exists with machine code ${machineCode}`);

  // Idempotent: an already-unpaired code answers like a successful call, with the same
  // body shape as the write below.
  if (!kiosk.externalDeviceId) {
    return res.status(200).json(new ApiResponse(200, { kiosk: describeKiosk(kiosk) }, 'Device already unpaired'));
  }
  if (hardwareUUID !== kiosk.externalDeviceId) {
    throw new ApiError(409, `Hardware UUID does not match the device paired to ${machineCode}`);
  }
  if (["RESERVED", "ASSIGNED"].includes(kiosk.status)) {
    throw new ApiError(409, `${machineCode} is ${kiosk.status.toLowerCase()} on an order; finish that order before unpairing`);
  }

  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    // Conditional on the device still being the one we read, so a pairing that lands in
    // between cannot be undone by this call.
    const released = await tx.kiosk.updateMany({
      where: { machineCode, externalDeviceId: hardwareUUID },
      data: {
        externalDeviceId: null,
        status: kiosk.status === "INSTALLED" ? "AVAILABLE" : kiosk.status,
      },
    });
    if (released.count !== 1) {
      throw new ApiError(409, `${machineCode} changed while it was being unpaired; retry`);
    }
    // Close the ownership window pairing opened: revenue attribution only counts rows
    // whose assignedTo is still null.
    await tx.kioskAssignment.updateMany({
      where: { kioskId: kiosk.id, assignedTo: null },
      data: { assignedTo: now },
    });
    return tx.kiosk.findUniqueOrThrow({ where: { id: kiosk.id } });
  });

  res.status(200).json(new ApiResponse(200, {
    kiosk: describeKiosk(updated),
  }, `Hardware ${hardwareUUID} unpaired from ${machineCode}`));
});

function describeKiosk(kiosk: {
  machineCode: string;
  model: string | null;
  status: string;
  externalDeviceId: string | null;
}) {
  return {
    machineCode: kiosk.machineCode,
    model: kiosk.model,
    status: kiosk.status,
    externalDeviceId: kiosk.externalDeviceId,
  };
}
