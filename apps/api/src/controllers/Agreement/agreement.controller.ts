import type {Request,Response} from "express" 
import {prisma} from "../../utils/db"
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { CreateAgreementSchema } from "@shared-types/validationSchemas/agreement.validation"


//Only compnay and distribuotrs can make agreements
export const createAgreement = asyncHandler(async (req: Request, res: Response) => {
  const { networkConnectionId, childOrgId, parentSharePct,childSharePct, depositAmountPerMachine, nonRefundableAmountPerMachine } = CreateAgreementSchema.parse(req.body);
  
  const parentOrgId = req.membership!.organizationId;
  const parentOrgType = req.membership!.type;

  // Check if the network exists between the parties
  const connection = await prisma.networkConnection.findFirst({
    where: { id: networkConnectionId, status: 'ACTIVE' }
  });

  if (!connection) throw new ApiError(400, 'Active network connection required to draft an agreement');
  
  const childOrg = await prisma.organization.findUnique({ where: { id: childOrgId } });
  
  if (!childOrg) throw new ApiError(404, 'Child organization not found');

  if (parentOrgType === "DISTRIBUTOR" && childOrg.type === "PARTNER") {
    // Check if the partner has an existing agreement with a distributor
    const existingDistributorLink = await prisma.agreement.findFirst({
      where: {
        childOrgId,
        parentOrg: { type: 'DISTRIBUTOR' },
        status: 'ACTIVE'
      }
    });

    if (existingDistributorLink) throw new ApiError(409, 'This Partner already has an active agreement with a Distributor');
  }

  let finalParentPct = 0;
  let finalChildPct = 0;
  let finalDepositAmount = 0;
  let finalNonRefundableAmount = 0;

  // Logic for DISTRIBUTOR -> PARTNER
  if (parentOrgType === 'DISTRIBUTOR') {
    finalParentPct = 60;
    finalChildPct = 40;

    // Distributors cannot supply custom deposit/non-refundable amounts. 
    // They must inherit them from the active agreement between the COMPANY and this DISTRIBUTOR.
    const distributorParentAgreement = await prisma.agreement.findFirst({
      where: {
        childOrgId: parentOrgId, // The distributor is the child of a company in their own agreement
        parentOrg: { type: 'COMPANY' },
        status: 'ACTIVE'
      }
    });

    if (!distributorParentAgreement) {
      throw new ApiError(400, 'Distributor must have an active agreement with a Company before onboarding partners');
    }

    finalDepositAmount = Number(distributorParentAgreement.depositAmountPerMachine ?? 0);
    finalNonRefundableAmount = Number(distributorParentAgreement.nonRefundableAmountPerMachine ?? 0);
  } 
  // Logic for COMPANY -> X (Distributor or Partner)
  else if (parentOrgType === 'COMPANY') {
    if (parentSharePct === undefined || childSharePct === undefined || (parentSharePct + childSharePct !== 100)) {
      throw new ApiError(400, 'Company agreements require explicit share percentages totaling 100');
    }

    if (depositAmountPerMachine === undefined || nonRefundableAmountPerMachine === undefined) {
      throw new ApiError(400, 'Company agreements require explicit deposit and non-refundable amounts per machine');
    }

    finalParentPct = parentSharePct;
    finalChildPct = childSharePct;
    finalDepositAmount = depositAmountPerMachine;
    finalNonRefundableAmount = nonRefundableAmountPerMachine;
  }

  const agreement = await prisma.agreement.create({
    data: {
      networkConnectionId,
      parentOrgId,
      childOrgId,
      parentSharePct: finalParentPct,
      childSharePct: finalChildPct,
      depositAmountPerMachine: finalDepositAmount,
      nonRefundableAmountPerMachine: finalNonRefundableAmount,
      status: 'PENDING_APPROVAL',
      effectiveFrom: new Date(), 
    }
  });
    
  res.status(201).json(new ApiResponse(201, { agreement }, 'Agreement drafted and sent for approval'));
});

export const approveAgreement = asyncHandler(async (req: Request, res: Response) => {
  const { agreementId } = req.params;
  const currentOrgId = req.membership!.organizationId;
   
   if(typeof agreementId !== "string") throw new ApiError(404,"Invalid connection ID");

  // The child organization is the one approving the drafted agreement
  const agreement = await prisma.agreement.findFirst({
    where: { id: agreementId, childOrgId: currentOrgId, status: 'PENDING_APPROVAL' }
  });

  if (!agreement) throw new ApiError(404, 'Pending agreement not found or unauthorized');

  const updatedAgreement = await prisma.agreement.update({
    where: { id: agreementId },
    data: { 
      status: 'ACTIVE',
      effectiveFrom: new Date() // The clock starts exactly when approved
    }
  });

  res.status(200).json(new ApiResponse(200, { agreement: updatedAgreement }, 'Agreement approved and now active'));

});

export const terminateAgreement = asyncHandler(async (req: Request, res: Response) => {
  const { agreementId } = req.params;
  const currentOrgId = req.membership!.organizationId;

  if(typeof agreementId !== "string") throw new ApiError(404,"Invalid connection ID");

  //Only the Parent can terminate the agreement
  const agreement = await prisma.agreement.findFirst({
    where: {
      id: agreementId,
      status: 'ACTIVE',
      parentOrgId: currentOrgId 
    }
  });

  if (!agreement) throw new ApiError(404, 'Active agreement not found');

  const terminatedAgreement = await prisma.agreement.update({
    where: { id: agreementId },
    data: {
      status: 'TERMINATED',
      effectiveTo: new Date()
    }
  });

  res.status(200).json(new ApiResponse(200, { agreement: terminatedAgreement }, 'Agreement securely terminated'));
});

