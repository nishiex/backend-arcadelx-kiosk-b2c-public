import type { Request,Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import crypto from "crypto"
import { prisma } from "../utils/db";
import { ApiResponse } from "../utils/ApiResponse";
import { ApproveRequestSchema, UpdateRoleSchema, PaginationQuerySchema } from '@shared-types/validationSchemas/member.validation';
import { ApiError } from "../utils/ApiError";

const ROLE_WEIGHT: Record<string, number> = { OWNER: 3, ADMIN: 2, MANAGER: 1, STAFF: 0 };

export const generateInviteCode = asyncHandler(async(req:Request,res:Response) => {
    
    const orgId = req.membership!.organizationId;
    let code = "";
    const chars = "ABCDEFGHIJKLMNPQRSTUVWXYZ23456789abcdefghijklmnopqrstuvwxyz";
    for (let i = 0; i < 6; i++) {
        const index = crypto.randomInt(chars.length);
        code += chars[index];
    }
    const expiresAt = new Date (Date.now()+7*24*60*60*1000);

    const org = await prisma.organization.update({
        where:{
            id:orgId,
        },  
        data:{
            inviteCode:code,
            inviteCodeExpiresAt:expiresAt
        },
        // Only return invite fields: older databases may lack profile columns.
        select:{inviteCode:true,inviteCodeExpiresAt:true}
    })

    res.status(201).json(new ApiResponse(201,{inviteCode: org.inviteCode,expiresAt: org.inviteCodeExpiresAt},"New invite code generated successfully"))
});

export const getPendingRequests = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit } = PaginationQuerySchema.parse(req.query);
  const skip = (page - 1) * limit;
  const orgId = req.membership!.organizationId;

  const [total, requests] = await prisma.$transaction([
    prisma.membership.count({ where: { organizationId: orgId, status: 'PENDING' } }),
    prisma.membership.findMany({
      where: { organizationId: orgId, status: 'PENDING' },
      skip,
      take: limit,
      include: {
        user: { select: { id: true, name: true, email: true, createdAt: true } }
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    })
  ], { isolationLevel: 'RepeatableRead' });

  res.status(200).json(new ApiResponse(200, { 
    data: requests, 
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) } 
  }, 'Pending requests fetched successfully'));
});
export const handleJoinRequest = asyncHandler(async(req:Request,res:Response)=>
{
    const membershipId = req.params.membershipId;
    const {action,role} = ApproveRequestSchema.parse(req.body)
    
    const actingRole = req.membership!.role;
    const orgId = req.membership!.organizationId;
    
    if (!membershipId || typeof membershipId !== 'string') {
    return res.status(400).json(
        new ApiError(400,'Invalid membership ID')
    );
}
    if (action === 'APPROVE') {
      if (!role || ROLE_WEIGHT[role] === undefined || ROLE_WEIGHT[actingRole] === undefined)
        throw new ApiError(400, 'Invalid role');
      if (ROLE_WEIGHT[role]! >= ROLE_WEIGHT[actingRole]!)
        throw new ApiError(403, `You cannot assign a role equal to or higher than your own (${actingRole})`);
    }
    const updatedMembership = await prisma.$transaction(async tx => {
      const changed = await tx.membership.updateMany({
        where: { id: membershipId, organizationId: orgId, status: 'PENDING' },
        data: action === 'APPROVE' ? { status: 'ACTIVE', role: role! } : { status: 'REJECTED', role: null },
      });
      if (changed.count !== 1) throw new ApiError(400, 'Request already processed or not found');
      return tx.membership.findUniqueOrThrow({ where: { id: membershipId } });
    });
    res.status(200).json(new ApiResponse(200,
      action === 'APPROVE' ? { membership: updatedMembership } : null,
      action === 'APPROVE' ? 'Member approved and role assigned' : 'Join request rejected'));
    
})

export const updateMemberRole = asyncHandler(async (req: Request, res: Response) => {
  const { membershipId } = req.params;
  const { role: newRole } = UpdateRoleSchema.parse(req.body);

  const actingRole = req.membership!.role;
  const orgId = req.membership!.organizationId;

  if (!membershipId || typeof membershipId !== 'string') {
    return res.status(400).json(
      new ApiError(400, 'Invalid membership ID')
    );
  }

  const targetMembership = await prisma.membership.findFirst({
    where: {
      id: membershipId,
      organizationId: orgId,
      status: 'ACTIVE'
    }
  });

  if (!targetMembership) throw new ApiError(404, 'Active member not found');

  if (targetMembership.userId === req.user!.id) throw new ApiError(400, 'You cannot change your own role');

  // Target membership.role is Role | null
  if (!targetMembership.role) throw new ApiError(400, 'Target member has no role');

  const targetRoleWeight = ROLE_WEIGHT[targetMembership.role];
  const actingRoleWeight = ROLE_WEIGHT[actingRole];
  const newRoleWeight = ROLE_WEIGHT[newRole];

  if (targetRoleWeight === undefined || actingRoleWeight === undefined || newRoleWeight === undefined) throw new ApiError(400, 'Invalid role');

  // Can acting user modify the target user?
  if (targetRoleWeight >= actingRoleWeight) 
 {
    throw new ApiError(403,'You cannot modify a user with a role equal to or higher than yours');
 }

  // Can acting user assign the requested role?
  if (newRoleWeight >= actingRoleWeight) throw new ApiError(403,`You cannot assign a role equal to or higher than your own (${actingRole})`);

  const updatedMembership = await prisma.membership.update({
    where: { id: membershipId },
    data: { role: newRole }
  });

  res.status(200).json(new ApiResponse(200,{ membership: updatedMembership },'Member role updated successfully'));

});


export const removeMember = asyncHandler(async (req: Request, res: Response) => {
  const { membershipId } = req.params;
  const actingRole = req.membership!.role;
  const orgId = req.membership!.organizationId;

  if (!membershipId || typeof membershipId !== 'string') throw new ApiError(400, 'Invalid membership ID');

  const targetMembership = await prisma.membership.findFirst({
    where: {
      id: membershipId,
      organizationId: orgId,
      status: 'ACTIVE',
    },
  });

  if (!targetMembership) throw new ApiError(404, 'Active member not found');

  if (targetMembership.userId === req.user!.id) throw new ApiError( 400,'You cannot remove yourself. Use the leave organization endpoint.');
  
  if (!targetMembership.role) throw new ApiError(400, 'Target member has no role');


  const targetRoleWeight = ROLE_WEIGHT[targetMembership.role];
  const actingRoleWeight = ROLE_WEIGHT[actingRole];

  if (targetRoleWeight === undefined || actingRoleWeight === undefined) throw new ApiError(400, 'Invalid role');

  if (targetRoleWeight >= actingRoleWeight) throw new ApiError( 403,'You cannot remove a user with a role equal to or higher than yours');
  

  await prisma.membership.delete({
    where: {
      id: membershipId,
    },
  });

  res.status(200).json( new ApiResponse(200, null, 'Member removed successfully') );

});
