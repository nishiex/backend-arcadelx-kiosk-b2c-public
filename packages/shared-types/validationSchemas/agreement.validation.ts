import { z } from 'zod';

export const CreateAgreementSchema = z.object({
  networkConnectionId: z.string().uuid(),
  childOrgId: z.string().uuid(),
  parentSharePct: z.number().min(0).max(70).optional(), // Optional because Distributor logic overwrites it
  childSharePct: z.number().min(0).max(30).optional(),
});