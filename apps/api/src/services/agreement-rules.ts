import type { OrgType, Prisma } from "../generated/prisma/client";
import { ApiError } from "../utils/ApiError";

export async function lockAgreementParties(
  tx: Prisma.TransactionClient,
  parentOrgId: string,
  childOrgId: string,
  connectionId: string,
) {
  // Serialize every agreement writer on its child, including competing distributors.
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${childOrgId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "NetworkConnection" WHERE id=${connectionId} FOR UPDATE`;
  const [parent, child, connection] = await Promise.all([
    tx.organization.findUnique({
      where: { id: parentOrgId },
      select: { id: true, type: true },
    }),
    tx.organization.findUnique({
      where: { id: childOrgId },
      select: { id: true, type: true },
    }),
    tx.networkConnection.findUnique({ where: { id: connectionId } }),
  ]);
  if (!parent || !child) throw new ApiError(404, "Organization not found");
  if (
    parentOrgId === childOrgId ||
    !(
      (parent.type === "COMPANY" &&
        ["DISTRIBUTOR", "PARTNER"].includes(child.type)) ||
      (parent.type === "DISTRIBUTOR" && child.type === "PARTNER")
    )
  ) {
    throw new ApiError(400, "Invalid parent/child organization relationship");
  }
  if (
    !connection ||
    connection.status !== "ACTIVE" ||
    connection.initiatorOrgId !== parentOrgId ||
    connection.receiverOrgId !== childOrgId
  ) {
    throw new ApiError(
      400,
      "An active network connection between these exact organizations is required",
    );
  }
  return { parent, child };
}

/**
 * Which organization types may act as the immediate supplier of a kiosk request.
 *
 * The registration hierarchy is COMPANY -> DISTRIBUTOR -> PARTNER, but a PARTNER may
 * also be supplied directly by the COMPANY: a Company can register a Partner itself
 * (POST /api/auth/register with orgType PARTNER) and a Company->PARTNER agreement is a
 * valid, approvable relationship. Accepting only a DISTRIBUTOR parent here therefore
 * left every Company-registered Partner unable to request kiosks at all, even while
 * holding an ACTIVE agreement. Later entries are fallback tiers, closest link first.
 */
export const IMMEDIATE_SUPPLIER_TYPES: Record<string, readonly OrgType[]> = {
  DISTRIBUTOR: ["COMPANY"],
  PARTNER: ["DISTRIBUTOR", "COMPANY"],
};

/**
 * Resolve the single ACTIVE agreement a kiosk request must be routed through.
 *
 * The agreement -- not `Organization.parentOrgId` -- decides who supplies: the parent
 * pointer only records which organization registered this one. When a Partner holds an
 * agreement in more than one allowed tier, the closest link wins (its Distributor),
 * which is both the chain's immediate supplier and the behaviour such Partners already
 * had. Two ACTIVE agreements inside one tier stay ambiguous and are refused rather than
 * guessed: the agreement-slot rules do not create that state, so it means reconciliation.
 */
export async function requireImmediateSupplier(
  tx: Prisma.TransactionClient,
  childOrgId: string,
  childOrgType: string,
) {
  const allowedTypes = IMMEDIATE_SUPPLIER_TYPES[childOrgType];
  if (!allowedTypes) {
    throw new ApiError(403, "Only Partners and Distributors can request kiosks");
  }
  const agreements = await tx.agreement.findMany({
    where: {
      childOrgId,
      status: "ACTIVE",
      parentOrg: { is: { type: { in: [...allowedTypes] } } },
    },
    include: { parentOrg: { select: { id: true, name: true, type: true } } },
  });
  if (agreements.length === 0) {
    throw new ApiError(
      403,
      "Cannot create request: No active agreement with the required immediate supplier found",
    );
  }
  const rank = (type: OrgType) => allowedTypes.indexOf(type);
  const closest = Math.min(...agreements.map((agreement) => rank(agreement.parentOrg.type)));
  const candidates = agreements.filter((agreement) => rank(agreement.parentOrg.type) === closest);
  if (candidates.length > 1) {
    throw new ApiError(
      409,
      "Multiple active supplier agreements found; contact support before requesting kiosks",
    );
  }
  return candidates[0]!;
}

export async function requireAgreementSlot(
  tx: Prisma.TransactionClient,
  parentOrgId: string,
  childOrgId: string,
  parentType: string,
  excludeId?: string,
) {
  const conflict = await tx.agreement.findFirst({
    where: {
      childOrgId,
      status: { in: ["PENDING_APPROVAL", "ACTIVE"] },
      ...(excludeId ? { id: { not: excludeId } } : {}),
      OR: [
        { parentOrgId },
        ...(parentType === "DISTRIBUTOR"
          ? [{ parentOrg: { type: "DISTRIBUTOR" as const } }]
          : []),
      ],
    },
  });
  if (conflict)
    throw new ApiError(
      409,
      "An active or pending agreement already occupies this relationship",
    );
}
