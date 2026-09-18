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

  const updatedKiosk = await prisma.kiosk.update({
    where: { machineCode },
    data: { externalDeviceId },
    select: {
      machineCode: true,
      externalDeviceId: true,
      model: true
    }
  });

  res.status(200).json(new ApiResponse(200, { kiosk: updatedKiosk }, 'Hardware device paired successfully'));
});