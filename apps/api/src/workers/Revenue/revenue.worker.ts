import { Worker } from 'bullmq';
import { prisma } from '../../utils/db';
import { revenueRedisOptions } from '../../config/redis';
import { createRevenueQueue, statementJobId, type RevenueJobData } from '../../queues/Revenue/revenueStatement.queue';
import { processRevenueStatement } from '../../services/Revenue/revenueStatement.service';
import { syncRevenueData } from '../../services/Revenue/revenueTransaction.services';
import { syncDevices } from '../../services/Revenue/deviceSync.service';

export function previousRevenueMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric' }).formatToParts(now);
  const year = Number(parts.find(p => p.type === 'year')!.value);
  const month = Number(parts.find(p => p.type === 'month')!.value);
  return month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year };
}
export function revenueJobPeriod(job: { timestamp: number; opts: { prevMillis?: number } }) {
  // BullMQ creates delayed jobs ahead of time; prevMillis is their scheduled run.
  return previousRevenueMonth(new Date(job.opts.prevMillis ?? job.timestamp));
}
export async function startRevenueJobs() {
  if (!process.env.MOTHERSHIP_TRANSACTION_API_URL) throw new Error('MOTHERSHIP_TRANSACTION_API_URL is required for revenue jobs');
  const queue = createRevenueQueue();
  const worker = new Worker<RevenueJobData>('revenue-statements', async job => {
    // Register/refresh devices first: the transaction sync attributes a payment by
    // looking a kiosk up by externalDeviceId, so a device that is not recorded yet
    // would leave its payments unattributed.
    if (job.name === 'sync-transactions') {
      const devices = process.env.MOTHERSHIP_DEVICE_API_URL ? await syncDevices() : null;
      return { devices, transactions: await syncRevenueData() };
    }
    if (job.name === 'monthly-statements') {
      const { month, year } = revenueJobPeriod(job);
      const orgs = await prisma.organization.findMany({ where: { type: { in: ['DISTRIBUTOR', 'PARTNER'] }, isActive: true }, select: { id: true } });
      for (const org of orgs) await queue.add('statement', { targetOrgId: org.id, month, year }, { jobId: statementJobId(org.id, month, year) });
      return;
    }
    const { targetOrgId, month, year } = job.data;
    if (job.name !== 'statement' || !targetOrgId || !month || !year) throw new Error('Invalid revenue job');
    await processRevenueStatement(targetOrgId, month, year);
  }, { connection: revenueRedisOptions(), concurrency: 5 });
  worker.on('error', () => console.error('[Revenue] Worker connection error'));
  worker.on('failed', job => console.error('[Revenue] Job failed:', job?.id));
  queue.on('error', () => console.error('[Revenue] Queue connection error'));
  try {
    await queue.upsertJobScheduler('nightly-sync', { pattern: '0 0 * * *', tz: 'Asia/Kolkata' }, { name: 'sync-transactions', data: {} });
    await queue.upsertJobScheduler('monthly-revenue', { pattern: '0 2 1 * *', tz: 'Asia/Kolkata' }, { name: 'monthly-statements', data: {} });
  } catch (error) { await worker.close(); await queue.close(); throw error; }
  return { close: async () => { await worker.close(); await queue.close(); } };
}
