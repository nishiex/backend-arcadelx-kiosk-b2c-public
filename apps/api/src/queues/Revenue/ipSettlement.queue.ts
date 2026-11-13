import { Queue } from 'bullmq';
import { revenueRedisOptions } from '../../config/redis';

export interface IpSettlementJobData {
  organizationId: string;
  month: number;
  year: number;
  attempt?: number;
  maxAttempts?: number;
}

export const ipSettlementQueue = new Queue<IpSettlementJobData>('ip-settlements', {
  connection: revenueRedisOptions(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});
