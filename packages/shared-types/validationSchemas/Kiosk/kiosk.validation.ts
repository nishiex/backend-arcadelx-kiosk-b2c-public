import { z } from 'zod';

export const BatchCreateKiosksSchema = z.object({
  count: z.number().int().min(1).max(100), // Max 100 per batch to prevent payload overwhelming
  model: z.string().min(1)
});

export const UpdateKioskStatusSchema = z.object({
  status: z.enum(['AVAILABLE', 'RESERVED', 'ASSIGNED', 'INSTALLED', 'MAINTENANCE', 'RETURNED', 'RETIRED']),
  location: z.string().optional()
});

export const ManualOverrideExternalIdSchema = z.object({
  externalDeviceId: z.string().length(36).uuid().nullable()
});

export const PairDeviceSchema = z.object({
  externalDeviceId: z.string().length(36).uuid()
});
