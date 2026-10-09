import { z } from "zod";
import { prisma } from "../../utils/db";
import { recordOpeningAssignments } from "../kiosk-ownership";
import { machineCodeCounterFloor } from "../machine-code-sequence";

/**
 * Devices sync.
 *
 * The devices feed is the authoritative list of hardware. `externalDeviceId` is
 * documented in `internal.controller.ts` as "Mothership's UUID (The Link)" and the
 * payments sync already resolves a kiosk by it, so this endpoint is the natural source
 * for it: registering kiosks here is what makes payment rows attributable.
 *
 * Behaviour:
 *   - a device already linked to a kiosk updates that kiosk (location refreshes);
 *   - an unknown device becomes a new AVAILABLE kiosk, keeping the device id verbatim
 *     as its machine code;
 *   - processing is oldest-seen first, so a fleet numbering gap is filled by the
 *     earliest device rather than by feed order.
 *
 * Nothing is deleted: a device missing from the feed is left alone, because the feed is
 * a snapshot and hardware can simply be switched off.
 */

const deviceSchema = z.object({
  device_id: z.string().min(1),
  location: z.string().nullish(),
  is_online: z.boolean().nullish(),
  last_seen: z.coerce.date().nullish(),
  kiosk_number: z.coerce.number().int().nullish(),
});

const payloadSchema = z.object({
  devices: z.array(deviceSchema),
});

export type DeviceSyncResult = {
  totalRecordsFetched: number;
  newKiosksCreated: number;
  kiosksUpdated: number;
  devicesWithoutId: number;
  rejectedRecords: number;
  createdMachineCodes: string[];
};

/** Default model for a device discovered by sync, when the feed does not say. */
const DISCOVERED_MODEL = "Unassigned";

function normaliseLocation(location: string | null | undefined) {
  const trimmed = location?.trim();
  return trimmed ? trimmed : null;
}

export async function syncDevices(): Promise<DeviceSyncResult> {
  const url = process.env.MOTHERSHIP_DEVICE_API_URL;
  if (!url) throw new Error("Device source is not configured");
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error("Device source returned HTTP " + response.status);
  const payload: unknown = await response.json();
  // Accept the envelope the device feed uses, and a bare array for parity with the
  // transaction source.
  const records: unknown = Array.isArray(payload) ? payload : (payload as { devices?: unknown } | null)?.devices ?? null;
  if (!Array.isArray(records)) throw new Error("Expected a device array");

  let devicesWithoutId = 0;
  let rejectedRecords = 0;
  const parsed: z.infer<typeof deviceSchema>[] = [];
  for (const input of records) {
    const result = deviceSchema.safeParse(input);
    if (result.success) parsed.push(result.data);
    else if (input && typeof input === "object" && "device_id" in input) rejectedRecords++;
    else devicesWithoutId++;
  }
  // A gap in fleet numbering should be filled by the earliest device, not by feed order.
  parsed.sort((a, b) => (a.last_seen?.getTime() ?? 0) - (b.last_seen?.getTime() ?? 0));

  // Whoever currently holds the fleet owns a discovered kiosk; the same rule the batch
  // creation path applies. Without any organization we cannot attribute one.
  const company = await prisma.organization.findFirst({ where: { type: "COMPANY" }, select: { id: true } });

  let newKiosksCreated = 0;
  let kiosksUpdated = 0;
  const createdMachineCodes: string[] = [];

  for (const device of parsed) {
    const existing = await prisma.kiosk.findFirst({
      where: { OR: [{ externalDeviceId: device.device_id }, { machineCode: device.device_id }] },
      select: { id: true, externalDeviceId: true, location: true },
    });

    if (existing) {
      const location = normaliseLocation(device.location);
      const needsLink = existing.externalDeviceId !== device.device_id;
      const needsLocation = location !== null && location !== existing.location;
      if (needsLink || needsLocation) {
        await prisma.kiosk.update({
          where: { id: existing.id },
          data: {
            ...(needsLink ? { externalDeviceId: device.device_id } : {}),
            ...(needsLocation ? { location } : {}),
          },
        });
        kiosksUpdated++;
      }
      continue;
    }

    if (!company) {
      rejectedRecords++;
      continue;
    }
    try {
      await prisma.$transaction(async tx => {
        const kiosk = await tx.kiosk.create({
          data: {
            machineCode: device.device_id,
            model: DISCOVERED_MODEL,
            status: "AVAILABLE",
            currentOrgId: company.id,
            externalDeviceId: device.device_id,
            location: normaliseLocation(device.location),
          },
          select: { id: true, currentOrgId: true },
        });
        // A discovered device is operational, so its ownership ledger starts now;
        // otherwise its payments would be stored but never attributed.
        await recordOpeningAssignments(tx, [kiosk], null);
      });
      newKiosksCreated++;
      createdMachineCodes.push(device.device_id);
      // A synced device whose id follows the ADLX-YYYY-A### pattern occupies a slot in the
      // batch generator's numbering. Keep the counter ahead of it, or the next Add Machine
      // would try to mint a code that already exists. See machine-code-sequence.ts.
      const floor = machineCodeCounterFloor(device.device_id, new Date().getUTCFullYear());
      if (floor > 0) {
        await prisma.$executeRaw`
          INSERT INTO "MachineSequence" (year, value) VALUES (${new Date().getUTCFullYear()}, ${floor})
          ON CONFLICT (year) DO UPDATE SET value = GREATEST("MachineSequence".value, ${floor})`;
      }
    } catch {
      // A concurrent sync or a colliding machine code: the device is already represented.
      rejectedRecords++;
    }
  }

  return {
    totalRecordsFetched: records.length,
    newKiosksCreated,
    kiosksUpdated,
    devicesWithoutId,
    rejectedRecords,
    createdMachineCodes,
  };
}
