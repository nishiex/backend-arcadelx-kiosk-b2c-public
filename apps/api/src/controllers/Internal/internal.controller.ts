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

export const UnpairKioskDevice = asyncHandler(async(req:Request,res:Response)=>{
  
  const { machineCode, hardwareUUID } = req.params;

  if(typeof machineCode !== "string")throw new ApiError(400,"Machine Code should be a string");
  
  const kiosk = await prisma.kiosk.findFirst({where:{machineCode}});

  if(!kiosk)throw new ApiError(400,"Kiosk Doesnt Exist ,Please enter a Machine Code that exists");

  //check id already unpaired
  if(kiosk.externalDeviceId === null) return res.status(200).json(new ApiResponse(200,"Device already Unpaired Successfully"));

  //check if the hardware that we need to unpair is acctually same 
  if(hardwareUUID != kiosk.externalDeviceId)throw new ApiError(404,`Hardware UUID doesnt match to Id presnt in Business DB for ${machineCode}`);

  // Conditional on the hardware we just read: a pairing that lands in between cannot be undone
  // by this call, and a mismatch leaves the row untouched instead of half-applied. Only an
  // INSTALLED machine returns to sellable stock — a kiosk reserved on an order or in
  // maintenance keeps the status its lifecycle set.
  const released = await prisma.kiosk.updateMany({
    where: { machineCode, externalDeviceId: hardwareUUID },
    data: {
      externalDeviceId: null,
      ...(kiosk.status === "INSTALLED" ? { status: "AVAILABLE" as const } : {}),
    },
  });
  if (released.count !== 1) {
    throw new ApiError(409, `${machineCode} changed while it was being unpaired; retry`);
  }

  const updatedKiosk = await prisma.kiosk.findUniqueOrThrow({
    where: { machineCode },
    select: {
      machineCode: true,
      externalDeviceId: true,
      model: true,
      status: true,
    },
  });
  
  res.status(200).json(new ApiResponse(200, { kiosk: updatedKiosk }, `${machineCode} of hardware_uuid ${hardwareUUID} unpaired successfully`));

})