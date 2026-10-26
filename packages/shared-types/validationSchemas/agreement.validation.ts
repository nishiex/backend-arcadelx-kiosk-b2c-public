import { z } from "zod";

export const CreateAgreementSchema = z
  .object({
    // The agreement flow can create/activate the direct parent-child connection
    // atomically when the parent sends the agreement.
    networkConnectionId: z.string().uuid().optional(),
    childOrgId: z.string().uuid(),
    parentSharePct: z.number().min(0).max(100).optional(),
    childSharePct: z.number().min(0).max(100).optional(),
    depositAmountPerMachine: z.number().int().min(0).max(2147483647).optional(),
    nonRefundableAmountPerMachine: z
      .number()
      .int()
      .min(0)
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
    depositAmountPerMachine: z.number().int().min(0).max(2147483647).optional(),
    nonRefundableAmountPerMachine: z
      .number()
      .int()
      .min(0)
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
  );
