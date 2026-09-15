import type {Request,Response} from "express" 
import {prisma} from "../../utils/db"
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/ApiError";
import { ApiResponse } from "../../utils/ApiResponse";
import { CreateAgreementSchema } from "@shared-types/validationSchemas/agreement.validation"


//Only compnay and distribuotrs can make agreements
export const createAgreement = asyncHandler(async(req:Request,res:Response)=>
{
    const { networkConnectionId, childOrgId, parentSharePct, childSharePct } = CreateAgreementSchema.parse(req.body);
    const parentOrgId = req.membership!.organizationId;
    const parentOrgType = req.membership!.type;

    //Check if the network existis between the parties
    const connection = await prisma.networkConnection.findFirst({
    where: { id: networkConnectionId, status: 'ACTIVE' }
     });

    if (!connection) throw new ApiError(400, 'Active network connection required to draft an agreement');
    
    const childOrg = await prisma.organization.findUnique({ where: { id: childOrgId } });
    
    if (!childOrg) throw new ApiError(404, 'Child organization not found');

    if(parentOrgType === "DISTRIBUTOR" && childOrg.type === "PARTNER")
    {
        //Check if the partner has an exiting agreement with a distributor , as 1 partner can make agreement with 1 distributor only
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

    // if the agreement is between DISTRIBUTOR-> PARTNER , it will be alwasy 60:40 
    if (parentOrgType === 'DISTRIBUTOR') {
        finalParentPct = 60;
        finalChildPct = 40;
    } 
    // if the agreement is between COMPANY->X , let company decide the equity
    else if (parentOrgType === 'COMPANY') 
    {
    if (parentSharePct === undefined || childSharePct === undefined || (parentSharePct + childSharePct !== 100)) {
      throw new ApiError(400, 'Company agreements require explicit share percentages totaling 100');
    }

    finalParentPct = parentSharePct;
    finalChildPct = childSharePct;
  }

  const agreement = await prisma.agreement.create({
    data: {
      networkConnectionId,
      parentOrgId,
      childOrgId,
      parentSharePct: finalParentPct,
      childSharePct: finalChildPct,
      status: 'PENDING_APPROVAL',
      effectiveFrom: new Date(), // Temporarily set, updated upon actual approval
    }
  });
    
    res.status(201).json(new ApiResponse(201, { agreement }, 'Agreement drafted and sent for approval'));

})


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

