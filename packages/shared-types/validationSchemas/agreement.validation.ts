import { z } from 'zod';

export const CreateAgreementSchema = z.object({
  networkConnectionId: z.string().uuid(),
  childOrgId: z.string().uuid(),
  parentSharePct: z.number().min(0).max(100).optional(), 
  childSharePct: z.number().min(0).max(100).optional(),
  depositAmountPerMachine: z.number().min(0).optional(),
  nonRefundableAmountPerMachine: z.number().min(0).optional()
}).refine((data) => {
  const { parentSharePct, childSharePct } = data;

  // If neither is provided (e.g., Distributor flow), it passes
  if (parentSharePct === undefined && childSharePct === undefined) {
    return true;
  }

  // If only one is provided, it fails
  if (parentSharePct === undefined || childSharePct === undefined) {
    return false;
  }

  // Both are provided, so safely check their sum
  return (parentSharePct + childSharePct) === 100;
}, {
  message: "Both parent and child share percentages must be provided and must sum up to 100",
  path: ["parentSharePct"],
});