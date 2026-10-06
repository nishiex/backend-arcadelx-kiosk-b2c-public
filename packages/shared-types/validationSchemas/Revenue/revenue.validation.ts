import { z } from 'zod';

export const SettingsSchema = z.object({
  gstPercentage: z.number().min(0).max(100).multipleOf(0.01).optional(),
  pgFeePercentage: z.number().min(0).max(100).multipleOf(0.01).optional(),
  tdsPercentage : z.number().min(0).max(100).multipleOf(0.01).optional()
}).strict().refine(value => Object.values(value).some(v => v !== undefined), 'Provide at least one rate');
