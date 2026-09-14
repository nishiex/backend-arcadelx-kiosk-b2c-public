import { z } from 'zod';

export const RoleEnum = z.enum(['ADMIN', 'MANAGER', 'STAFF']); 

export const ApproveRequestSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  role: RoleEnum.optional(),
}).refine(data => {
  if (data.action === 'APPROVE' && !data.role) return false;
  return true;
}, { message: "Role is required when approving a request" });

export const UpdateRoleSchema = z.object({
  role: RoleEnum,
});

export const PaginationQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).default('1').transform(Number),
  limit: z.string().regex(/^\d+$/).default('10').transform(Number),
});