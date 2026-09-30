import { z } from "zod";

export const DistributorParamsSchema = z.object({ distributorId: z.string().uuid() });
export const DistributorStatusSchema = z.object({ isActive: z.boolean() }).strict();
