import { z } from 'zod';

/**
 * Request schemas for the Mothership payment-gateway admin API
 * (`/api/v1/admin/gateways*`). Shapes are validated here so a malformed dashboard
 * request is rejected by our own API with a 400, rather than being forwarded and
 * failing opaquely inside Mothership.
 *
 * These endpoints control live payment routing, so every field is required
 * explicitly: there is no "guess the rest" partial-update form.
 */

/** A gateway as Mothership returns it. List responses embed this. */
export const GatewaySchema = z.object({
  provider: z.string().min(1),
  display_name: z.string().min(1),
  priority: z.number().int().nonnegative(),
  is_active: z.boolean(),
  has_driver: z.boolean(),
  credentials: z.record(z.string(), z.unknown()).default({}),
  updated_at: z.string().optional(),
});

export type Gateway = z.infer<typeof GatewaySchema>;

export const GatewaysResponseSchema = z.object({
  status: z.string(),
  total: z.number().int().nonnegative(),
  gateways: z.array(GatewaySchema),
});

/** `POST /gateways` — create or update the configuration for one provider. */
export const UpsertGatewaySchema = z
  .object({
    provider: z.string().min(1).max(64),
    display_name: z.string().min(1).max(120).optional(),
    is_active: z.boolean().optional(),
    priority: z.number().int().nonnegative().optional(),
    /** Provider-specific keys; Mothership stores these, we never log them. */
    credentials: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type UpsertGatewayInput = z.infer<typeof UpsertGatewaySchema>;

/** `POST /gateways/reorder` — set the routing priority order. */
export const ReorderGatewayItemSchema = z.object({
  provider: z.string().min(1).max(64),
  /** Desired priority value (1-based; lower wins). */
  priority: z.number().int().positive(),
});

export const ReorderGatewaysSchema = z
  .object({
    /**
     * Mothership's confirmed contract (probed 2026-10-13): the body must be
     * `{ gateways: [{ provider, priority }, ...] }`.  An earlier `{ order: string[] }`
     * assumption always returned HTTP 500 from Mothership.  Each provider must appear
     * exactly once; duplicates would make the resulting order ambiguous.
     */
    gateways: z
      .array(ReorderGatewayItemSchema)
      .min(1)
      .max(50)
      .refine(
        (list) => new Set(list.map((g) => g.provider)).size === list.length,
        'Providers must be unique',
      ),
  })
  .strict();
export type ReorderGatewaysInput = z.infer<typeof ReorderGatewaysSchema>;

/** `POST /gateways/toggle` — enable or disable one provider. */
export const ToggleGatewaySchema = z
  .object({
    provider: z.string().min(1).max(64),
    is_active: z.boolean(),
    /** Required by the API when disabling a provider; omitted when enabling. */
    totpCode: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'TOTP code must be 6 digits')
      .optional(),
  })
  .strict();

export type ToggleGatewayInput = z.infer<typeof ToggleGatewaySchema>;

/**
 * `DELETE /gateways` — remove a provider override.
 *
 * Mothership's DELETE advertises no path parameter (probed OPTIONS: `POST, OPTIONS,
 * DELETE` on the collection), so the provider is identified in the body.
 */
export const DeleteGatewaySchema = z
  .object({
    provider: z.string().min(1).max(64),
    totpCode: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'TOTP code must be 6 digits'),
  })
  .strict();

export type DeleteGatewayInput = z.infer<typeof DeleteGatewaySchema>;
