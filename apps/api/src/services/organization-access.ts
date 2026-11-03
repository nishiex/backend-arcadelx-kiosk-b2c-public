import type { Prisma } from "../generated/prisma/client";
import { prisma } from "../utils/db";
import { ApiError } from "../utils/ApiError";

export type OrganizationAccess = { id: string; type: string; isActive: boolean; accessVersion: number };

// JSON field extraction preserves existing logins before this additive migration
// is deployed. Status writes are unavailable until BOTH columns exist. Never
// cache access state: each authenticated request must see a committed deactivation.
export async function getUserOrganizationAccess(
  userId: string,
  db: typeof prisma | Prisma.TransactionClient = prisma,
  _lock = false,
): Promise<OrganizationAccess | undefined> {
  // Prisma does not expose row-level FOR UPDATE locking. The caller's transaction
  // still keeps session creation atomic, while this relation query avoids raw SQL and
  // works against the current Organization schema.
  return (await db.organization.findFirst({
    where: { memberships: { some: { userId } } },
    select: { id: true, type: true, isActive: true, accessVersion: true },
  })) ?? undefined;
}

export function assertOrganizationActive(access: OrganizationAccess | undefined) {
  if (access?.type === "DISTRIBUTOR" && !access.isActive) {
    throw new ApiError(403, "Your distributor account is inactive. Contact the Company to reactivate it.");
  }
}
