import { prisma } from '../../utils/db';
import { setDeviceGamePrice } from './devices.service';

export const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'Asia/Kolkata';
let eodPricingTime = process.env.EOD_PRICE_RUN_TIME || '00:00';

function validatePricingTime(time: string): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error('EOD pricing time must use HH:mm format, for example 00:00 or 23:30');
  }
  return time;
}

/** Change the daily EOD pricing time for the running API process. */
export function setEodPricingTime(time: string): string {
  eodPricingTime = validatePricingTime(time);
  return eodPricingTime;
}

export function getEodPricingTime(): string {
  return eodPricingTime;
}

export function businessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`;
}

/**
 * Convert a business-zone wall clock (`YYYY-MM-DDTHH:mm`) to its UTC instant.
 * Asia/Kolkata has no DST, so the single correction pass is exact there; for a DST
 * zone it can be off by an hour inside the transition hour, which is still closer
 * than any fixed offset and needs no timezone library.
 */
function wallClockToInstant(wallClock: string): Date {
  const guess = new Date(`${wallClock}:00.000Z`);
  const rendered = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIMEZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(guess);
  const part = (type: string) => rendered.find(item => item.type === type)!.value;
  const renderedAsUtc = Date.parse(`${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}Z`);
  return new Date(guess.getTime() - (renderedAsUtc - guess.getTime()));
}

/**
 * The next occurrence of `runTime` in the business zone: today's if it is still
 * ahead, otherwise the next business day's.
 *
 * This used to return tomorrow's run time unconditionally, so a run time set later
 * in the current business day never fired that day: an update scheduled for the
 * current day stayed PENDING until the following day, and the API advertised a next
 * execution the timer would not actually use. With the default `00:00` the passed
 * occurrence and tomorrow coincide, which is why the defect only surfaced once an
 * operator picked a later time.
 */
export function nextEod(now = new Date(), runTime = eodPricingTime): string {
  validatePricingTime(runTime);
  const today = businessDate(now);
  const todayRun = wallClockToInstant(`${today}T${runTime}`);
  if (todayRun.getTime() > now.getTime()) return todayRun.toISOString();
  const tomorrow = new Date(`${today}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return wallClockToInstant(`${tomorrow.toISOString().slice(0, 10)}T${runTime}`).toISOString();
}

/**
 * The instant an update scheduled for `scheduledDate` is applied.
 *
 * `applyPendingEodUpdates` applies every row whose business date has been reached,
 * so a row runs at the first execution whose business date is at or after its own
 * scheduled date -- which is not necessarily the very next run. Reporting the next
 * run for every scheduled date told an operator their future-dated change would be
 * applied on the wrong day.
 */
export function eodRunForDate(scheduledDate: string, now = new Date(), runTime = eodPricingTime): string {
  const next = nextEod(now, runTime);
  if (businessDate(new Date(next)) >= scheduledDate) return next;
  return wallClockToInstant(`${scheduledDate}T${runTime}`).toISOString();
}

export async function assertDeviceNotRetired(deviceId: string) {
  const kiosk = await prisma.kiosk.findFirst({
    where: { OR: [{ externalDeviceId: deviceId }, { machineCode: deviceId }] },
    select: { status: true },
  });
  if (kiosk?.status === 'RETIRED') {
    throw new Error('Retired kiosks cannot receive game price changes');
  }
}

export async function scheduleEodDevicePrice(input: { deviceId: string; gameId: string; displayName: string; price: number; replayPrice: number; createdById: string; scheduledDate?: string }) {
  await assertDeviceNotRetired(input.deviceId);
  const selectedDate = input.scheduledDate ?? businessDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) throw new Error('Scheduled date must use YYYY-MM-DD');
  if (selectedDate < businessDate()) throw new Error('Scheduled date cannot be in the past');
  const day = new Date(`${selectedDate}T00:00:00.000Z`);
  return prisma.eodDevicePriceUpdate.upsert({
    where: { deviceId_gameId_businessDate: { deviceId: input.deviceId, gameId: input.gameId, businessDate: day } },
    // Enumerate the columns instead of spreading `input`: `scheduledDate` is a request
    // field, not a column, and spreading it made every dated schedule fail with
    // "Unknown argument `scheduledDate`" (HTTP 500) before anything was written.
    create: {
      deviceId: input.deviceId,
      gameId: input.gameId,
      displayName: input.displayName,
      price: input.price,
      replayPrice: input.replayPrice,
      createdById: input.createdById,
      businessDate: day,
      status: 'PENDING',
    },
    update: { displayName: input.displayName, price: input.price, replayPrice: input.replayPrice, status: 'PENDING', processingAt: null, lastError: null, appliedAt: null, verifiedPrice: null, verifiedReplayPrice: null },
  });
}

export async function recoverStaleEodUpdates() {
  const recovered = await prisma.eodDevicePriceUpdate.updateMany({
    where: {
      status: 'PROCESSING',
      processingAt: { lt: new Date(Date.now() - 20 * 60 * 1000) },
    },
    data: {
      status: 'FAILED',
      processingAt: null,
      lastError: 'Recovered after a worker restart or timeout; retrying.',
    },
  });
  return recovered.count;
}

export async function processEodUpdate(id: string) {
  // Bind every later state transition to this exact lease timestamp. If a stale
  // worker is recovered and another invocation claims the row, the old worker
  // cannot overwrite the newer worker's result.
  const leaseAt = new Date();
  const claimed = await prisma.eodDevicePriceUpdate.updateMany({
    where: { id, status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: 8 } },
    data: { status: 'PROCESSING', processingAt: leaseAt, attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) return { skipped: true };
  const row = await prisma.eodDevicePriceUpdate.findUniqueOrThrow({ where: { id } });
  try {
    await assertDeviceNotRetired(row.deviceId);
    const result = await setDeviceGamePrice(row.deviceId, row.gameId, { price: Number(row.price), replay_price: Number(row.replayPrice), scope: 'DEVICE' });
    const applied = await prisma.eodDevicePriceUpdate.updateMany({
      where: { id, status: 'PROCESSING', processingAt: leaseAt },
      data: { status: 'APPLIED', processingAt: null, appliedAt: new Date(), lastError: null, verifiedPrice: result.price, verifiedReplayPrice: result.replayPrice },
    });
    if (applied.count !== 1) {
      throw new Error('EOD processing lease was lost before the verified result was saved');
    }
    return { skipped: false, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown upstream pricing error';
    await prisma.eodDevicePriceUpdate.updateMany({ where: { id, status: 'PROCESSING', processingAt: leaseAt }, data: { status: 'FAILED', processingAt: null, lastError: message } });
    console.error('[EOD pricing] update failed', { id, deviceId: row.deviceId, gameId: row.gameId, message });
    throw error;
  }
}

export async function pricingStatus(deviceId: string, gameId: string) {
  const update = await prisma.eodDevicePriceUpdate.findFirst({
    where: { deviceId, gameId },
    orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
  });
  return update ? { id: update.id, businessDate: update.businessDate.toISOString().slice(0, 10), status: update.status, price: Number(update.price), replayPrice: Number(update.replayPrice), attempts: update.attempts, lastError: update.lastError, appliedAt: update.appliedAt, createdAt: update.createdAt } : null;
}

/**
 * After an immediate, verified device write, close out any scheduled row that is due.
 *
 * A row scheduled for today or earlier would otherwise be applied by the next EOD run and
 * silently revert the price an operator just set live. The row is moved to APPLIED with the
 * values that are actually on the device now, so the schedule table keeps one truthful
 * record instead of a stale intent.
 */
export async function markScheduledUpdatesSuperseded(
  deviceId: string,
  gameId: string,
  price: number,
  replayPrice: number,
): Promise<number> {
  const today = new Date(`${businessDate()}T00:00:00.000Z`);
  const superseded = await prisma.eodDevicePriceUpdate.updateMany({
    where: { deviceId, gameId, status: { in: ['PENDING', 'FAILED'] }, businessDate: { lte: today } },
    data: {
      price,
      replayPrice,
      status: 'APPLIED',
      processingAt: null,
      appliedAt: new Date(),
      lastError: null,
      verifiedPrice: price,
      verifiedReplayPrice: replayPrice,
    },
  });
  return superseded.count;
}

/** Apply every EOD price update that is due. Safe to call from a timer or HTTP cron. */
export async function applyPendingEodUpdates() {
  const recovered = await recoverStaleEodUpdates();
  const today = new Date(`${businessDate()}T00:00:00.000Z`);
  const pending = await prisma.eodDevicePriceUpdate.findMany({
    where: { status: { in: ['PENDING', 'FAILED'] }, businessDate: { lte: today }, attempts: { lt: 8 } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  let applied = 0;
  let failed = 0;
  let skipped = 0;
  for (let index = 0; index < pending.length; index += 3) {
    const batch = pending.slice(index, index + 3);
    const results = await Promise.all(batch.map(async update => {
      try {
        const result = await processEodUpdate(update.id);
        return result.skipped ? 'skipped' : 'applied';
      } catch {
        return 'failed';
      }
    }));
    for (const result of results) {
      if (result === 'applied') applied += 1;
      else if (result === 'skipped') skipped += 1;
      else failed += 1;
    }
  }

  return { businessDate: businessDate(), found: pending.length, processed: applied + failed, applied, failed, skipped, recovered };
}
