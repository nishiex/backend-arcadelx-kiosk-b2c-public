import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from '../utils/db';
import { revenueRedisOptions } from '../config/redis';
import { createDevicePricingQueue } from '../queues/devicePricing.queue';
import { BUSINESS_TIMEZONE, businessDate, isEodDue, processEodUpdate, recoverStaleEodUpdates } from '../services/Mothership/eod-pricing.service';

/** Fail fast at startup so an unavailable optional scheduler never blocks the API. */
async function assertRedisAvailable() {
  const connection = new IORedis({
    ...revenueRedisOptions(),
    lazyConnect: true,
    connectTimeout: 3_000,
    retryStrategy: () => null,
  });
  try {
    await connection.connect();
    await connection.ping();
  } finally {
    connection.disconnect();
  }
}

async function enqueueDue(queue: ReturnType<typeof createDevicePricingQueue>) {
  await recoverStaleEodUpdates();
  const today = new Date(`${businessDate()}T00:00:00.000Z`);
  // Poll every minute so each row can use the operator's chosen time. Older rows
  // are always overdue; today's rows become due only at their own wall-clock time.
  const candidates = await prisma.eodDevicePriceUpdate.findMany({ where: { status: { in: ['PENDING', 'FAILED'] }, businessDate: { lte: today }, attempts: { lt: 8 } }, select: { id: true, businessDate: true, scheduledTime: true } });
  const rows = candidates.filter(row => row.businessDate < today || (row.businessDate.getTime() === today.getTime() && isEodDue(new Date(), row.scheduledTime)));
  for (const row of rows) await queue.add('apply-eod-price', { updateId: row.id }, { jobId: `eod-price-${row.id}` });
}

export async function startDevicePricingJobs() {
  await assertRedisAvailable();
  const queue = createDevicePricingQueue();
  const worker = new Worker<{ updateId?: string }>('device-eod-pricing', async job => {
    if (!job.data.updateId) { await enqueueDue(queue); return; }
    return processEodUpdate(job.data.updateId);
  }, { connection: revenueRedisOptions(), concurrency: 3 });
  worker.on('failed', (job, error) => console.error('[EOD pricing] job failed', { id: job?.data.updateId, error: error.message }));
  worker.on('error', error => console.error('[EOD pricing] worker error', error));
  queue.on('error', error => console.error('[EOD pricing] queue error', error));
  await queue.upsertJobScheduler('eod-prices', { pattern: '* * * * *', tz: BUSINESS_TIMEZONE }, { name: 'enqueue-eod-prices', data: {} });
  await queue.add('enqueue-eod-prices', {}, { jobId: `eod-bootstrap-${businessDate()}` });
  return { close: async () => { await worker.close(); await queue.close(); } };
}
