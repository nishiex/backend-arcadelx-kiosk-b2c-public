import { z } from "zod";

export const RoleEnum = z.enum(["ADMIN", "MANAGER", "STAFF"]);

export const GenerateInviteSchema = z.object({ role: RoleEnum.optional() });

export const ApproveRequestSchema = z
  .object({
    action: z.enum(["APPROVE", "REJECT"]),
    role: RoleEnum.optional(),
  })
  .refine(
    (data) => {
      if (data.action === "APPROVE" && !data.role) return false;
      return true;
    },
    { message: "Role is required when approving a request" },
  );

export const UpdateRoleSchema = z.object({
  role: RoleEnum,
});

export const PaginationQuerySchema = z.object({
  page: z
    .string()
    .regex(/^\d+$/)
    .default("1")
    .transform(Number)
    .pipe(z.number().int().min(1).max(1000000)),
  limit: z
    .string()
    .regex(/^\d+$/)
    .default("10")
    .transform(Number)
    .pipe(z.number().int().min(1).max(100)),
});
