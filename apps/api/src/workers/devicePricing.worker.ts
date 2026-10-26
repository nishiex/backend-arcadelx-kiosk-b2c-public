import { Worker } from 'bullmq';
import { prisma } from '../utils/db';
import { revenueRedisOptions } from '../config/redis';
import { createDevicePricingQueue } from '../queues/devicePricing.queue';
import { BUSINESS_TIMEZONE, businessDate, processEodUpdate, recoverStaleEodUpdates } from '../services/Mothership/eod-pricing.service';

async function enqueueDue(queue: ReturnType<typeof createDevicePricingQueue>) {
  await recoverStaleEodUpdates();
  const today = new Date(`${businessDate()}T00:00:00.000Z`);
  const rows = await prisma.eodDevicePriceUpdate.findMany({ where: { status: { in: ['PENDING', 'FAILED'] }, businessDate: { lt: today }, attempts: { lt: 8 } }, select: { id: true } });
  for (const row of rows) await queue.add('apply-eod-price', { updateId: row.id }, { jobId: `eod-price-${row.id}` });
}

export async function startDevicePricingJobs() {
  const queue = createDevicePricingQueue();
  const worker = new Worker<{ updateId?: string }>('device-eod-pricing', async job => {
    if (!job.data.updateId) { await enqueueDue(queue); return; }
    return processEodUpdate(job.data.updateId);
  }, { connection: revenueRedisOptions(), concurrency: 3 });
  worker.on('failed', (job, error) => console.error('[EOD pricing] job failed', { id: job?.data.updateId, error: error.message }));
  worker.on('error', error => console.error('[EOD pricing] worker error', error));
  queue.on('error', error => console.error('[EOD pricing] queue error', error));
  await queue.upsertJobScheduler('eod-midnight', { pattern: '0 0 * * *', tz: BUSINESS_TIMEZONE }, { name: 'enqueue-eod-prices', data: {} });
  await queue.add('enqueue-eod-prices', {}, { jobId: `eod-bootstrap-${businessDate()}` });
  return { close: async () => { await worker.close(); await queue.close(); } };
}
