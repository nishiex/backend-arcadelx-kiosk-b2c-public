import { prisma } from '../../utils/db';
import { setDeviceGamePrice } from './devices.service';

export const BUSINESS_TIMEZONE = process.env.BUSINESS_TIMEZONE || 'Asia/Kolkata';

export function businessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`;
}

export function nextEod(now = new Date()): string {
  const tomorrow = new Date(`${businessDate(now)}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  // Convert the next business-day wall-clock midnight to an instant. The second
  // pass handles DST zones without adding a timezone library to the API.
  const wallClock = tomorrow.toISOString().slice(0, 10) + 'T00:00:00.000Z';
  const guess = new Date(wallClock);
  const rendered = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIMEZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(guess);
  const part = (type: string) => rendered.find(item => item.type === type)!.value;
  const renderedAsUtc = Date.parse(`${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}Z`);
  return new Date(guess.getTime() - (renderedAsUtc - guess.getTime())).toISOString();
}

export async function scheduleEodDevicePrice(input: { deviceId: string; gameId: string; displayName: string; price: number; replayPrice: number; createdById: string }) {
  const day = new Date(`${businessDate()}T00:00:00.000Z`);
  return prisma.eodDevicePriceUpdate.upsert({
    where: { deviceId_gameId_businessDate: { deviceId: input.deviceId, gameId: input.gameId, businessDate: day } },
    create: { ...input, businessDate: day, status: 'PENDING' },
    update: { displayName: input.displayName, price: input.price, replayPrice: input.replayPrice, status: 'PENDING', processingAt: null, lastError: null, appliedAt: null, verifiedPrice: null, verifiedReplayPrice: null },
  });
}

export async function recoverStaleEodUpdates() {
  await prisma.eodDevicePriceUpdate.updateMany({ where: { status: 'PROCESSING', processingAt: { lt: new Date(Date.now() - 20 * 60 * 1000) } }, data: { status: 'FAILED', processingAt: null, lastError: 'Recovered after a worker restart or timeout; retrying.' } });
}

export async function processEodUpdate(id: string) {
  const claimed = await prisma.eodDevicePriceUpdate.updateMany({ where: { id, status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: 8 } }, data: { status: 'PROCESSING', processingAt: new Date(), attempts: { increment: 1 } } });
  if (claimed.count !== 1) return { skipped: true };
  const row = await prisma.eodDevicePriceUpdate.findUniqueOrThrow({ where: { id } });
  try {
    const result = await setDeviceGamePrice(row.deviceId, row.gameId, { price: Number(row.price), replay_price: Number(row.replayPrice), scope: 'DEVICE' });
    await prisma.eodDevicePriceUpdate.update({ where: { id }, data: { status: 'APPLIED', processingAt: null, appliedAt: new Date(), lastError: null, verifiedPrice: result.price, verifiedReplayPrice: result.replayPrice } });
    return { skipped: false, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown upstream pricing error';
    await prisma.eodDevicePriceUpdate.updateMany({ where: { id, status: 'PROCESSING' }, data: { status: 'FAILED', processingAt: null, lastError: message } });
    console.error('[EOD pricing] update failed', { id, deviceId: row.deviceId, gameId: row.gameId, message });
    throw error;
  }
}

export async function pricingStatus(deviceId: string, gameId: string) {
  const day = new Date(`${businessDate()}T00:00:00.000Z`);
  const update = await prisma.eodDevicePriceUpdate.findUnique({ where: { deviceId_gameId_businessDate: { deviceId, gameId, businessDate: day } } }) ?? await prisma.eodDevicePriceUpdate.findFirst({ where: { deviceId, gameId, status: { in: ['PROCESSING', 'FAILED'] } }, orderBy: { businessDate: 'desc' } });
  return update ? { id: update.id, status: update.status, price: Number(update.price), replayPrice: Number(update.replayPrice), attempts: update.attempts, lastError: update.lastError, appliedAt: update.appliedAt, createdAt: update.createdAt } : null;
}
