import { z } from 'zod';

export const SettingsSchema = z.object({
  gstPercentage: z.number().min(0).max(100).multipleOf(0.01).optional(),
  pgFeePercentage: z.number().min(0).max(100).multipleOf(0.01).optional(),
  tdsPercentage : z.number().min(0).max(100).multipleOf(0.01).optional()
}).strict().refine(value => Object.values(value).some(v => v !== undefined), 'Provide at least one rate');

/**
 * Supported windows for the dashboard revenue trend. Each range also selects its
 * bucket granularity: days for 7d/30d, ISO weeks for 3m, months for 1y.
 */
export const REVENUE_SERIES_RANGES = ['7d', '30d', '3m', '1y'] as const;
export type RevenueSeriesRange = (typeof REVENUE_SERIES_RANGES)[number];

export const RevenueSeriesQuerySchema = z.object({
  range: z.enum(REVENUE_SERIES_RANGES).default('30d'),
});

export const MothershipPaymentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
