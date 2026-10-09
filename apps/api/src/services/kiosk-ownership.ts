import type { Prisma } from "../generated/prisma/client";

/**
 * Records the opening ownership assignment for newly registered kiosks.
 *
 * `KioskAssignment` is the ownership ledger that revenue attribution and order
 * delivery both read: `getMachineWiseRevenue` only counts payments that fall inside an
 * assignment window, so a kiosk with no assignment row reports no revenue even when its
 * transactions exist. Registering a machine therefore has to open an assignment for the
 * organization that owns it.
 *
 * Delivery closes this row (sets `assignedTo`) and opens the recipient's own, so an
 * opening assignment is consistent with the transfer history rather than competing with
 * it. The `KioskAssignment_one_open_key` partial index allows one open row per kiosk.
 */
export async function recordOpeningAssignments(
  tx: Prisma.TransactionClient,
  kiosks: { id: string; currentOrgId: string | null }[],
  assignedById: string | null,
) {
  const candidates = kiosks.filter((kiosk): kiosk is { id: string; currentOrgId: string } => Boolean(kiosk.currentOrgId));
  if (!candidates.length) return 0;

  // Idempotent: a kiosk may already have an open assignment (batch create opens one, and
  // pairing runs afterwards), and `KioskAssignment_one_open_key` is a partial unique index
  // on (kioskId) WHERE assignedTo IS NULL -- so inserting a second row fails with a
  // conflict rather than being ignored.
  const alreadyOpen = await tx.kioskAssignment.findMany({
    where: { kioskId: { in: candidates.map(kiosk => kiosk.id) }, assignedTo: null },
    select: { kioskId: true },
  });
  const openIds = new Set(alreadyOpen.map(row => row.kioskId));
  const rows = candidates.filter(kiosk => !openIds.has(kiosk.id));
  if (!rows.length) return 0;

  // Fall back to an existing user when no acting user is available (the device sync runs
  // without a request context).
  let fallbackUserId = assignedById;
  if (!fallbackUserId) {
    const owner = await tx.user.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } });
    fallbackUserId = owner?.id ?? null;
  }
  if (!fallbackUserId) return 0;

  const created = await tx.kioskAssignment.createMany({
    data: rows.map(kiosk => ({
      kioskId: kiosk.id,
      organizationId: kiosk.currentOrgId,
      assignedById: fallbackUserId!,
    })),
  });
  return created.count;
}

/** Same, for kiosks selected by machine code (the batch-create path returns no ids). *//**
 * Guarantees the kiosk has an assignment window covering `occurredAt`, so a payment
 * imported for a past date is attributable rather than silently excluded.
 *
 * Registration opens an assignment at the moment of creation, which is later than a
 * historical payment. Options: leave it, backdate the open row, or open one.
 *
 * - an existing window (open or closed) that already covers the instant is left alone;
 * - otherwise an open row is backdated to the payment, or created when there is none.
 *
 * Backdating rather than inserting keeps the `KioskAssignment_one_open_key` partial
 * index satisfied (one open row per kiosk) and preserves the single ownership window.
 */
export async function ensureAssignmentCovering(
  tx: Prisma.TransactionClient,
  input: { kioskId: string; organizationId: string; assignedById: string | null; occurredAt: Date },
) {
  const covering = await tx.kioskAssignment.findFirst({
    where: {
      kioskId: input.kioskId,
      assignedFrom: { lte: input.occurredAt },
      OR: [{ assignedTo: null }, { assignedTo: { gt: input.occurredAt } }],
    },
    select: { id: true },
  });
  if (covering) return "covered" as const;

  const open = await tx.kioskAssignment.findFirst({
    where: { kioskId: input.kioskId, assignedTo: null },
    orderBy: { assignedFrom: "desc" },
    select: { id: true, assignedFrom: true },
  });
  if (open) {
    if (open.assignedFrom > input.occurredAt) {
      await tx.kioskAssignment.update({ where: { id: open.id }, data: { assignedFrom: input.occurredAt } });
      return "backdated" as const;
    }
    return "covered" as const;
  }

  let assignedById = input.assignedById;
  if (!assignedById) {
    const owner = await tx.user.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } });
    assignedById = owner?.id ?? null;
  }
  if (!assignedById) return "unattributable" as const;

  await tx.kioskAssignment.create({
    data: {
      kioskId: input.kioskId,
      organizationId: input.organizationId,
      assignedById,
      assignedFrom: input.occurredAt,
    },
  });
  return "created" as const;
}

/** Same, for kiosks selected by machine code (the batch-create path returns no ids). */
export async function recordOpeningAssignmentsByCode(
  tx: Prisma.TransactionClient,
  machineCodes: string[],
  assignedById: string | null,
) {
  if (!machineCodes.length) return 0;
  const kiosks = await tx.kiosk.findMany({
    where: { machineCode: { in: machineCodes } },
    select: { id: true, currentOrgId: true },
  });
  return recordOpeningAssignments(tx, kiosks, assignedById);
}
