import { z } from 'zod';

export const InitiateConnectionSchema = z.object({
  targetOwnerEmail: z.string().email("Must provide the valid email of the target organization's owner"),
});

