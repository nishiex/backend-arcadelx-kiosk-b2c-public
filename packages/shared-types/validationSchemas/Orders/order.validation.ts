import { z } from 'zod';

export const CreateOrderSchema = z.object({
  type: z.enum(['REQUEST', 'ALLOCATION']),
  targetOrgId: z.string().uuid(), // If REQUEST, this is the parent you are asking. If ALLOCATION, this is the child you are sending to.
  quantity: z.number().int().min(1).max(50)
});