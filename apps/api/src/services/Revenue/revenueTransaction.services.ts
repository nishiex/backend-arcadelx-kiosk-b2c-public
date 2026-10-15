import { prisma } from "../../utils/db";
import { z } from "zod";
import { ensureAssignmentCovering } from "../kiosk-ownership";

const paymentFeedSchema = z.object({
  txnid: z.string().min(1),
  device_id: z.string().min(1),
  game_id: z.union([z.string(), z.number()]).transform(String),
  amount: z
    .union([z.string(), z.number()])
    .transform(Number)
    .pipe(z.number().finite().nonnegative()),
  currency: z.string().min(1),
  status: z.string().min(1),
  provider: z.string().nullish(),
  qr_id: z.string().nullish(),
  created_at: z.coerce.date().transform((date) => date.toISOString()),
  updated_at: z.coerce.date().transform((date) => date.toISOString()),
});

export type MothershipPayment = z.infer<typeof paymentFeedSchema>;

async function fetchPaymentRecords(): Promise<unknown[]> {
  const url =
    process.env.MOTHERSHIP_TRANSACTION_API_URL ||
    "https://main.arcadelx.games/api/v1/payments";
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error("Transaction source returned HTTP " + response.status);
  const payload: unknown = await response.json();
  const records: unknown = Array.isArray(payload)
    ? payload
    : (payload as { data?: unknown } | null)?.data ?? null;
  if (!Array.isArray(records)) throw new Error("Expected a transaction array");
  return records;
}

/** Read and validate the current upstream payment feed without importing or mutating data. */
export async function getMothershipPayments(): Promise<{
  total: number;
  payments: MothershipPayment[];
  fetchedAt: string;
}> {
  const records = await fetchPaymentRecords();
  const parsed = z.array(paymentFeedSchema).safeParse(records);
  if (!parsed.success) {
    throw new Error(`Payment source returned invalid records (${parsed.error.issues.length})`);
  }
  return {
    total: parsed.data.length,
    payments: parsed.data,
    fetchedAt: new Date().toISOString(),
  };
}

const recordSchema = z.object({
  txnid: z.string().min(1),
  device_id: z.string().min(1),
  game_id: z.union([z.string(), z.number()]).transform(String),
  amount: z
    .union([z.string(), z.number()])
    .transform(String)
    .pipe(z.string().regex(/^\d{1,8}(\.\d{1,2})?$/)),
  currency: z.literal("INR").default("INR"),
  updated_at: z.coerce.date(),
});
export async function syncRevenueData() {
  let totalRecordsFetched = 0,
    newRecordsInserted = 0,
    unattributedCount = 0,
    invalidCount = 0;
  let failure: string | null = null;
  try {
    const records = await fetchPaymentRecords();
    totalRecordsFetched = records.length;
    const kiosks = await prisma.kiosk.findMany({
      select: { id: true, machineCode: true, externalDeviceId: true, currentOrgId: true },
    });
    const kiosksById = new Map(kiosks.map((kiosk) => [kiosk.id, kiosk]));
    const devices = new Map(
      kiosks
        .filter((k) => k.externalDeviceId)
        .map((k) => [k.externalDeviceId!, k.id]),
    );
    const codes = new Map(kiosks.map((k) => [k.machineCode, k.id]));
    const pending: { kioskId: string; record: z.infer<typeof recordSchema> }[] = [];
    for (const input of records) {
      if (!input || typeof input !== "object") {
        invalidCount++;
        continue;
      }
      if (!("status" in input) || input.status !== "completed") continue;
      const parsed = recordSchema.safeParse(input);
      if (!parsed.success) {
        invalidCount++;
        continue;
      }
      const record = parsed.data;
      const kioskId =
        devices.get(record.device_id) ?? codes.get(record.device_id);
      if (!kioskId) {
        unattributedCount++;
        continue;
      }
      pending.push({ kioskId, record });
    }

    if (pending.length) {
      // Read assignment windows once, then only repair coverage for each kiosk that has
      // an uncovered payment. The old implementation opened one transaction per payment;
      // with the live feed's 50 rows that could exceed Vercel's function time limit.
      const assignmentRows = await prisma.kioskAssignment.findMany({
        where: { kioskId: { in: [...new Set(pending.map(({ kioskId }) => kioskId))] } },
        select: { kioskId: true, assignedFrom: true, assignedTo: true },
      });
      const assignmentsByKiosk = new Map<string, typeof assignmentRows>();
      for (const assignment of assignmentRows) {
        const rows = assignmentsByKiosk.get(assignment.kioskId) ?? [];
        rows.push(assignment);
        assignmentsByKiosk.set(assignment.kioskId, rows);
      }
      const uncoveredByKiosk = new Map<string, Date>();
      for (const { kioskId, record } of pending) {
        const covered = (assignmentsByKiosk.get(kioskId) ?? []).some((assignment) =>
          assignment.assignedFrom <= record.updated_at &&
          (assignment.assignedTo === null || assignment.assignedTo > record.updated_at),
        );
        if (!covered) {
          const earliest = uncoveredByKiosk.get(kioskId);
          if (!earliest || record.updated_at < earliest) uncoveredByKiosk.set(kioskId, record.updated_at);
        }
      }

      const inserted = await prisma.$transaction(async (tx) => {
        for (const [kioskId, occurredAt] of uncoveredByKiosk) {
          const kiosk = kiosksById.get(kioskId);
          if (kiosk?.currentOrgId) {
            // Revenue is only counted inside an assignment window, so the window has to
            // cover the earliest uncovered payment for this kiosk.
            await ensureAssignmentCovering(tx, {
              kioskId,
              organizationId: kiosk.currentOrgId,
              assignedById: null,
              occurredAt,
            });
          }
        }
        return tx.transaction.createMany({
          data: pending.map(({ kioskId, record }) => ({
            kioskId,
            gameId: record.game_id,
            amount: record.amount,
            currency: record.currency,
            externalTransactionId: record.txnid,
            occurredAt: record.updated_at,
          })),
          skipDuplicates: true,
        });
      });
      newRecordsInserted = inserted.count;
    }
    if (invalidCount) failure = "Rejected transaction records: " + invalidCount;
  } catch (error) {
    failure =
      error instanceof Error &&
      /^(Transaction source|Expected)/.test(error.message)
        ? error.message
        : "Revenue synchronization failed";
  }
  await prisma.revenueSyncRunLog.create({
    data: {
      totalRecordsFetched,
      newRecordsInserted,
      unattributedCount,
      status: failure ? "FAILED" : "SUCCESS",
      errorMessage: failure,
    },
  });
  if (failure) throw new Error(failure);
  return { totalRecordsFetched, newRecordsInserted, unattributedCount };
}
