import { Job, Worker } from 'bullmq';
import { revenueRedisOptions } from '../../config/redis';
import type { IpSettlementJobData } from '../../queues/Revenue/ipSettlement.queue';
import {
  processIpMonthlySettlement,
  triggerMonthlyIpSettlements,
} from '../../services/Revenue/ipSettlement.service';

export const ipSettlementWorker = new Worker<IpSettlementJobData>(
  'ip-settlements',
  async (job: Job<IpSettlementJobData>) => {
    const { organizationId, month, year, attempt, maxAttempts } = job.data;

    // Check if job is a bounded gate-retry job
    if (job.name === 'gate-retry' || organizationId === '__scheduler_gate_retry__') {
      const currentAttempt = attempt ?? 1;
      const totalAttempts = maxAttempts ?? 5;
      console.log(
        `[IP Settlement Worker] Executing scheduled pipeline gate retry attempt ${currentAttempt}/${totalAttempts} for ${month}/${year}...`
      );
      await triggerMonthlyIpSettlements(Number(month), Number(year), {
        attempt: currentAttempt,
        maxRetries: totalAttempts,
        force: false, // Architectural Invariant: Never bypass pipeline-completion gate during automatic retries
      });
      return;
    }

    console.log(`[IP Settlement Worker] Processing settlement for IP Org: ${organizationId} | ${month}/${year}`);
    await processIpMonthlySettlement(organizationId, Number(month), Number(year));
  },
  {
    connection: revenueRedisOptions(),
    concurrency: 5,
  }
);

ipSettlementWorker.on('failed', (job, error) => {
  console.error(`[IP Settlement Worker] Job ${job?.id} failed for IP Org ${job?.data.organizationId}:`, error);
});

ipSettlementWorker.on('completed', (job) => {
  console.log(`[IP Settlement Worker] Job ${job.id} completed successfully for IP Org ${job.data.organizationId}`);
});
