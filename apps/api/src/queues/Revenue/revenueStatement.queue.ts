import { Queue } from 'bullmq';
import { revenueRedisOptions } from '../../config/redis';
export interface RevenueJobData { targetOrgId?: string; month?: number; year?: number }
export const statementJobId = (id: string, month: number, year: number) => `revenue-statement-${id}-${year}-${month}`;
export function createRevenueQueue() {
  return new Queue<RevenueJobData>('revenue-statements', {
    connection: revenueRedisOptions(),
    defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100, removeOnFail: 1000 },
  });
}
