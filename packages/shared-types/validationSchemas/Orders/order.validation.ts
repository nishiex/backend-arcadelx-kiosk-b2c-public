import { z } from "zod";

export const CreateOrderSchema = z.object({
  type: z.enum(["REQUEST", "ALLOCATION"]),
  targetOrgId: z.string().uuid(), // If REQUEST, this is the parent you are asking. If ALLOCATION, this is the child you are sending to.
  quantity: z.number().int().min(1).max(50),
});

export const OrderQuerySchema = z.object({
  status: z
    .enum(["UNDER_REVIEW", "APPROVED", "DISPATCHED", "DELIVERED", "REJECTED"])
    .optional(),
  type: z.enum(["REQUEST", "ALLOCATION"]).optional(),
});
