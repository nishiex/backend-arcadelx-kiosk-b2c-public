import type { Prisma } from "../generated/prisma/client";
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
