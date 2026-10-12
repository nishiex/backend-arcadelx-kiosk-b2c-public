import { z } from "zod";

export const OrderParamsSchema = z.object({ orderId: z.string().uuid() });

/**
 * Delivery must record where the kiosks physically go. The location is written onto each
 * kiosk as part of the ownership transfer, so it cannot be optional: previously the handler
 * hardcoded `location: null`, which erased any location and left delivered kiosks with no
 * recorded site.
 */
export const DeliverOrderSchema = z.object({
  location: z
    .string()
    .trim()
    .min(3, "Enter the delivery location")
    .max(200, "Delivery location must be 200 characters or fewer"),
});

// For REQUEST orders the Company supplier is always resolved automatically
// server-side — the client only needs to specify quantity.
// For ALLOCATION orders the caller must specify the target child org.
export const CreateOrderSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("REQUEST"),
    quantity: z.number().int().min(1).max(50),
  }),
  z.object({
    type: z.literal("ALLOCATION"),
    targetOrgId: z.string().uuid(), // child org to push kiosks to
    quantity: z.number().int().min(1).max(50),
  }),
]);

export const OrderQuerySchema = z.object({
  status: z
    .enum(["UNDER_REVIEW", "APPROVED", "DISPATCHED", "DELIVERED", "REJECTED"])
    .optional(),
  type: z.enum(["REQUEST", "ALLOCATION"]).optional(),
});
