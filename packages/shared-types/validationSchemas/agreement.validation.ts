import { z } from "zod";

export const CreateAgreementSchema = z
  .object({
    // The agreement flow can create/activate the direct parent-child connection
    // atomically when the parent sends the agreement.
    networkConnectionId: z.string().uuid().optional(),
    childOrgId: z.string().uuid(),
    parentSharePct: z.number().min(0).max(100).optional(),
    childSharePct: z.number().min(0).max(100).optional(),
    depositAmountPerMachine: z.number().int().min(1, "Total collected must be greater than zero").max(2147483647).optional(),
    nonRefundableAmountPerMachine: z
      .number()
      .int()
      .min(1, "Non-refundable fee must be greater than zero")
      .max(2147483647)
      .optional(),
  })
  .refine(
    (data) => {
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
      return parentSharePct + childSharePct === 100;
    },
    {
      message:
        "Both parent and child share percentages must be provided and must sum up to 100",
      path: ["parentSharePct"],
    },
  )
  // The non-refundable portion is deducted from the collection, so it can never exceed it.
  // Without this, a ₹1,00,000 collection with a ₹2,00,000 non-refundable fee was stored as
  // ACTIVE and every order against the agreement failed later at creation.
  .refine(
    (data) =>
      data.depositAmountPerMachine === undefined ||
      data.nonRefundableAmountPerMachine === undefined ||
      data.nonRefundableAmountPerMachine <= data.depositAmountPerMachine,
    {
      message: "Non-refundable fee cannot exceed the total collection per kiosk",
      path: ["nonRefundableAmountPerMachine"],
    },
  );

/**
 * Terms for replacing an active agreement. The API applies these as a new
 * effective-dated agreement version so historical orders and revenue keep the
 * terms that were in force when they occurred.
 */
export const UpdateAgreementSchema = z
  .object({
    parentSharePct: z.number().min(0).max(100).optional(),
    childSharePct: z.number().min(0).max(100).optional(),
    depositAmountPerMachine: z.number().int().min(1, "Total collected must be greater than zero").max(2147483647).optional(),
    nonRefundableAmountPerMachine: z
      .number()
      .int()
      .min(1, "Non-refundable fee must be greater than zero")
      .max(2147483647)
      .optional(),
  })
  .strict()
  .refine(
    (data) =>
      (data.parentSharePct === undefined && data.childSharePct === undefined) ||
      (data.parentSharePct !== undefined &&
        data.childSharePct !== undefined &&
        data.parentSharePct + data.childSharePct === 100),
    {
      message: "Both share percentages must be provided and must sum up to 100",
      path: ["parentSharePct"],
    },
  )
  .refine(
    (data) =>
      (data.depositAmountPerMachine === undefined &&
        data.nonRefundableAmountPerMachine === undefined) ||
      (data.depositAmountPerMachine !== undefined &&
        data.nonRefundableAmountPerMachine !== undefined),
    {
      message: "Both per-kiosk amounts must be provided together",
      path: ["depositAmountPerMachine"],
    },
  )
  .refine(
    (data) =>
      data.depositAmountPerMachine === undefined ||
      data.nonRefundableAmountPerMachine === undefined ||
      data.nonRefundableAmountPerMachine <= data.depositAmountPerMachine,
    {
      message: "Non-refundable fee cannot exceed the total collection per kiosk",
      path: ["nonRefundableAmountPerMachine"],
    },
  );
