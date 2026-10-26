import { Queue } from 'bullmq';
import { revenueRedisOptions } from '../config/redis';

export function createDevicePricingQueue() {
  return new Queue<{ updateId?: string }>('device-eod-pricing', { connection: revenueRedisOptions(), defaultJobOptions: { attempts: 8, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 100, removeOnFail: 1000 } });
}
