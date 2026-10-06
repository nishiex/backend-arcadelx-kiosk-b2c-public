import { prisma } from "../../utils/db";
import { z } from "zod";

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
    const url = process.env.MOTHERSHIP_TRANSACTION_API_URL;
    if (!url) throw new Error("Transaction source is not configured");
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok)
      throw new Error("Transaction source returned HTTP " + response.status);
    const records: unknown = await response.json();
    if (!Array.isArray(records))
      throw new Error("Expected a transaction array");
    totalRecordsFetched = records.length;
    const kiosks = await prisma.kiosk.findMany({
      select: { id: true, machineCode: true, externalDeviceId: true },
    });
    const devices = new Map(
      kiosks
        .filter((k) => k.externalDeviceId)
        .map((k) => [k.externalDeviceId!, k.id]),
    );
    const codes = new Map(kiosks.map((k) => [k.machineCode, k.id]));
    for (const input of records) {
      if (!input || typeof input !== "object") {
        invalidCount++;
        continue;
      }
      if (input.status !== "completed") continue;
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
      try {
        const inserted = await prisma.transaction.createMany({
          data: [
            {
              kioskId,
              gameId: record.game_id,
              amount: record.amount,
              currency: record.currency,
              externalTransactionId: record.txnid,
              occurredAt: record.updated_at,
            },
          ],
          skipDuplicates: true,
        });
        newRecordsInserted += inserted.count;
      } catch {
        invalidCount++;
      }
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
