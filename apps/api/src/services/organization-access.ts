import type { Prisma } from "../generated/prisma/client";
import { prisma } from "../utils/db";
import { ApiError } from "../utils/ApiError";

type Client = Prisma.TransactionClient;
export type OrganizationAccess = { id: string; type: string; isActive: boolean; accessVersion: number };

// JSON field extraction preserves existing logins before this additive migration
// is deployed. Status writes are unavailable until BOTH columns exist. Never
// cache access state: each authenticated request must see a committed deactivation.
export async function getUserOrganizationAccess(userId: string, db: Client = prisma, lock = false) {
  if (lock) {
    await db.$queryRaw`SELECT o.id FROM "Organization" o
      JOIN "Membership" m ON m."organizationId" = o.id
      WHERE m."userId" = ${userId} FOR UPDATE OF o`;
  }
  const rows = await db.$queryRaw<OrganizationAccess[]>`
    SELECT o.id, o.type,
      COALESCE((to_jsonb(o)->>'isActive')::boolean, true) AS "isActive",
      COALESCE((to_jsonb(o)->>'accessVersion')::integer, 0) AS "accessVersion"
    FROM "Organization" o JOIN "Membership" m ON m."organizationId" = o.id
    WHERE m."userId" = ${userId}
  `;
  return rows[0];
}

export function assertOrganizationActive(access: OrganizationAccess | undefined) {
  if (access?.type === "DISTRIBUTOR" && !access.isActive) {
    throw new ApiError(403, "Your distributor account is inactive. Contact the Company to reactivate it.");
  }
}
