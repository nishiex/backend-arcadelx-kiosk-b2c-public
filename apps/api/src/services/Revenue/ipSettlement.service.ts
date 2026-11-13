import fs from 'fs';
import path from 'path';
import { prisma } from '../../utils/db';
import { ApiError } from '../../utils/ApiError';
import { Prisma } from '../../generated/prisma/client';
import { sendEmail, checkEmailDelivery, type SendEmailParams } from '../email/email.service';
import {
  generateIpSettlementPdf,
  resolveMonthName,
  type IpSettlementPdfRow,
  type IpSettlementReportConfig,
} from '../pdf/ipSettlement.pdf';
import { ipSettlementQueue } from '../../queues/Revenue/ipSettlement.queue';

// =============================================================================
// TYPED DELEGATES & EXTENSIONS (Temporary shims pending `npx prisma generate`)
// =============================================================================

export interface IpSettlementLineItem {
  id: string;
  settlementId: string;
  ipGameId: string | null;
  gameIdentifier: string;
  gameDisplayName: string;
  kioskCount: number;
  grossRevenue: Prisma.Decimal | string;
  gstAmount: Prisma.Decimal | string;
  pgFeeAmount: Prisma.Decimal | string;
  networkShare: Prisma.Decimal | string;
  companyShareBeforeRoyalty: Prisma.Decimal | string;
  ipRoyaltyShare: Prisma.Decimal | string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IpSettlementWithDetails {
  id: string;
  organizationId: string;
  month: number;
  year: number;
  grossRevenue: Prisma.Decimal | string;
  gstAmount: Prisma.Decimal | string;
  pgFeeAmount: Prisma.Decimal | string;
  networkShare: Prisma.Decimal | string;
  companyShareBeforeRoyalty: Prisma.Decimal | string;
  ipRoyaltyShare: Prisma.Decimal | string;
  totalKioskCount: number;
  finalPayout: Prisma.Decimal | string | null;
  pdfPath: string | null;
  status: string;
  emailDeliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lines: IpSettlementLineItem[];
  organization?: any;
}

export interface IpSettlementDelegate {
  findUnique(args: { where: any; include?: any; select?: any }): Promise<IpSettlementWithDetails | null>;
  findMany(args?: any): Promise<IpSettlementWithDetails[]>;
  create(args: { data: any; include?: any }): Promise<IpSettlementWithDetails>;
  update(args: { where: any; data: any; include?: any }): Promise<IpSettlementWithDetails>;
  count(args?: any): Promise<number>;
}

export interface IpDailyGameRevenueDelegate {
  findMany(args?: any): Promise<any[]>;
}

export interface IpDailyGameKioskDelegate {
  findMany(args?: any): Promise<any[]>;
  deleteMany(args: { where: any }): Promise<{ count: number }>;
  createMany(args: { data: any[]; skipDuplicates?: boolean }): Promise<{ count: number }>;
}

export interface IpDailyRevenueJobRunDelegate {
  findMany(args?: any): Promise<any[]>;
  findFirst(args?: any): Promise<any | null>;
  findUnique(args: { where: any; select?: any }): Promise<any | null>;
  count(args?: any): Promise<number>;
}

export interface RevenueSyncRunLogDelegate {
  findFirst(args?: any): Promise<any | null>;
  findMany(args?: any): Promise<any[]>;
}

export interface ExtendedPrismaClient {
  organization: any;
  transactionSplit: any;
  ipSettlement: IpSettlementDelegate;
  ipDailyGameRevenue: IpDailyGameRevenueDelegate;
  ipDailyGameKiosk?: IpDailyGameKioskDelegate;
  ipDailyRevenueJobRun: IpDailyRevenueJobRunDelegate;
  revenueSyncRunLog: RevenueSyncRunLogDelegate;
  $transaction<T>(fn: (tx: ExtendedPrismaClient) => Promise<T>): Promise<T>;
}

const db = prisma as unknown as ExtendedPrismaClient;

/**
 * Pluggable email dispatch client with durable delivery verification.
 */
export const emailSender = {
  send: sendEmail,
  checkDelivery: checkEmailDelivery,
};

/**
 * Safe conversion to Prisma.Decimal to avoid float drift in financial aggregation.
 */
export const toDecimal = (val: unknown): Prisma.Decimal => {
  if (val === null || val === undefined || val === '') return new Prisma.Decimal(0);
  if (val instanceof Prisma.Decimal) return val;
  return new Prisma.Decimal(String(val));
};

/**
 * Returns UTC midnight date boundaries for a target IST calendar month.
 * e.g., October 2026:
 * startDate: 2026-10-01T00:00:00.000Z (inclusive)
 * endDate: 2026-11-01T00:00:00.000Z (exclusive)
 * lastDay: 2026-10-31T00:00:00.000Z
 */
export const getIstMonthBoundaries = (
  month: number,
  year: number
): { startDate: Date; endDate: Date; lastDayOfTargetMonth: Date } => {
  if (month < 1 || month > 12) {
    throw new ApiError(400, `Invalid month: ${month}. Month must be between 1 and 12.`);
  }
  if (year < 2000 || year > 2100) {
    throw new ApiError(400, `Invalid year: ${year}.`);
  }

  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 1));
  const lastDayOfTargetMonth = new Date(Date.UTC(year, month, 0)); // e.g. 2026-10-31 for month 10

  return { startDate, endDate, lastDayOfTargetMonth };
};

export interface PipelineGateResult {
  canProceed: boolean;
  reason?: string;
  details?: {
    lastDayDate: string;
    totalExpectedDays: number;
    successfulDaysCount: number;
    missingDays: string[];
    runningDays: string[];
    failedDays: string[];
    pendingSplitsCount: number;
    latestSyncStatus: string | null;
    latestSyncRunAt: string | null;
  };
}

/**
 * Strengthened Pipeline-Completion Gate:
 * Verifies that the upstream pipeline for the target month is 100% complete,
 * healthy, and finalized before monthly settlements can be generated or emailed.
 *
 * Checks:
 * 1. Every expected calendar day in the target month has a COMPLETED IpDailyRevenueJobRun with 0 failed batches.
 * 2. Rejects missing dates.
 * 3. Rejects FAILED and PARTIALLY_COMPLETED daily aggregation runs.
 * 4. Rejects dates with active RUNNING aggregation jobs.
 * 5. Relevant split calculation completed successfully: 0 PENDING splits remain in target month.
 * 6. Relevant revenue ingestion/sync completed successfully: latest RevenueSyncRunLog after end of month has status SUCCESS and 0 unsplit records.
 */
export async function checkMonthlyPipelineGate(
  month: number,
  year: number
): Promise<PipelineGateResult> {
  const { startDate, endDate, lastDayOfTargetMonth } = getIstMonthBoundaries(month, year);
  const lastDayStr = lastDayOfTargetMonth.toISOString().slice(0, 10);
  const totalDaysInMonth = lastDayOfTargetMonth.getUTCDate();

  // Enumerate all expected business dates for the month
  const expectedDates: string[] = [];
  for (let d = 1; d <= totalDaysInMonth; d++) {
    const dayDate = new Date(Date.UTC(year, month - 1, d));
    expectedDates.push(dayDate.toISOString().slice(0, 10));
  }

  // 1. Fetch all IpDailyRevenueJobRun records for the target month
  const allJobRuns = await db.ipDailyRevenueJobRun.findMany({
    where: {
      businessDate: {
        gte: startDate,
        lte: lastDayOfTargetMonth,
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Group job runs by businessDate string (YYYY-MM-DD)
  const runsByDate = new Map<string, any[]>();
  for (const run of allJobRuns) {
    const dStr = (run.businessDate instanceof Date ? run.businessDate : new Date(run.businessDate))
      .toISOString()
      .slice(0, 10);
    if (!runsByDate.has(dStr)) {
      runsByDate.set(dStr, []);
    }
    runsByDate.get(dStr)!.push(run);
  }

  const missingDays: string[] = [];
  const runningDays: string[] = [];
  const failedDays: string[] = [];
  let successfulDaysCount = 0;

  for (const dateStr of expectedDates) {
    const runs = runsByDate.get(dateStr);

    // Reject missing dates
    if (!runs || runs.length === 0) {
      missingDays.push(dateStr);
      continue;
    }

    // Reject dates with active RUNNING jobs
    if (runs.some((r) => r.status === 'RUNNING')) {
      runningDays.push(dateStr);
      continue;
    }

    // Inspect the most recent run for this businessDate
    const latestRun = runs[0];

    // Reject FAILED and PARTIALLY_COMPLETED runs
    if (latestRun.status === 'FAILED') {
      failedDays.push(`${dateStr} (FAILED: ${latestRun.errorMessage || 'No error message'})`);
      continue;
    }

    if (latestRun.status === 'PARTIALLY_COMPLETED' || (latestRun.batchesFailed ?? 0) > 0) {
      failedDays.push(`${dateStr} (PARTIALLY_COMPLETED: ${latestRun.batchesFailed} failed batches)`);
      continue;
    }

    if (latestRun.status !== 'COMPLETED') {
      failedDays.push(`${dateStr} (Status: ${latestRun.status})`);
      continue;
    }

    successfulDaysCount++;
  }

  // If any date is missing an aggregation run
  if (missingDays.length > 0) {
    return {
      canProceed: false,
      reason: `Pipeline gate rejected: Missing daily aggregation job runs for ${missingDays.length} date(s): ${missingDays.slice(0, 3).join(', ')}${missingDays.length > 3 ? '...' : ''}.`,
      details: {
        lastDayDate: lastDayStr,
        totalExpectedDays: totalDaysInMonth,
        successfulDaysCount,
        missingDays,
        runningDays,
        failedDays,
        pendingSplitsCount: 0,
        latestSyncStatus: null,
        latestSyncRunAt: null,
      },
    };
  }

  // If any date has an active RUNNING job
  if (runningDays.length > 0) {
    return {
      canProceed: false,
      reason: `Pipeline gate rejected: Active RUNNING daily aggregation jobs detected for date(s): ${runningDays.join(', ')}.`,
      details: {
        lastDayDate: lastDayStr,
        totalExpectedDays: totalDaysInMonth,
        successfulDaysCount,
        missingDays,
        runningDays,
        failedDays,
        pendingSplitsCount: 0,
        latestSyncStatus: null,
        latestSyncRunAt: null,
      },
    };
  }

  // If any date has a FAILED or PARTIALLY_COMPLETED run
  if (failedDays.length > 0) {
    return {
      canProceed: false,
      reason: `Pipeline gate rejected: Unsuccessful daily aggregation detected for date(s): ${failedDays.join('; ')}.`,
      details: {
        lastDayDate: lastDayStr,
        totalExpectedDays: totalDaysInMonth,
        successfulDaysCount,
        missingDays,
        runningDays,
        failedDays,
        pendingSplitsCount: 0,
        latestSyncStatus: null,
        latestSyncRunAt: null,
      },
    };
  }

  // 2. Verify Split Calculation completed successfully: 0 PENDING splits in target month
  const pendingSplitsCount = await db.transactionSplit.count({
    where: {
      businessDate: {
        gte: startDate,
        lte: lastDayOfTargetMonth,
      },
      status: 'PENDING',
    },
  });

  if (pendingSplitsCount > 0) {
    return {
      canProceed: false,
      reason: `Pipeline gate rejected: ${pendingSplitsCount} pending transaction splits remain in ${resolveMonthName(month)} ${year}. Split calculation is not complete.`,
      details: {
        lastDayDate: lastDayStr,
        totalExpectedDays: totalDaysInMonth,
        successfulDaysCount,
        missingDays,
        runningDays,
        failedDays,
        pendingSplitsCount,
        latestSyncStatus: null,
        latestSyncRunAt: null,
      },
    };
  }

  // 3. Verify Revenue Ingestion & Nightly Sync completed successfully after the target month
  const latestSyncLog = await db.revenueSyncRunLog.findFirst({
    where: {
      runAt: { gte: lastDayOfTargetMonth },
    },
    orderBy: { runAt: 'desc' },
  });

  if (!latestSyncLog) {
    return {
      canProceed: false,
      reason: `Pipeline gate rejected: No revenue sync run log found after ${lastDayStr}. Final period ingestion has not executed.`,
      details: {
        lastDayDate: lastDayStr,
        totalExpectedDays: totalDaysInMonth,
        successfulDaysCount,
        missingDays,
        runningDays,
        failedDays,
        pendingSplitsCount: 0,
        latestSyncStatus: null,
        latestSyncRunAt: null,
      },
    };
  }

  if (latestSyncLog.status !== 'SUCCESS') {
    return {
      canProceed: false,
      reason: `Pipeline gate rejected: Revenue ingestion/sync on ${new Date(latestSyncLog.runAt).toISOString()} failed (status: ${latestSyncLog.status}): ${latestSyncLog.errorMessage || 'Sync execution failed'}.`,
      details: {
        lastDayDate: lastDayStr,
        totalExpectedDays: totalDaysInMonth,
        successfulDaysCount,
        missingDays,
        runningDays,
        failedDays,
        pendingSplitsCount: 0,
        latestSyncStatus: latestSyncLog.status,
        latestSyncRunAt: new Date(latestSyncLog.runAt).toISOString(),
      },
    };
  }

  if ((latestSyncLog.unsplitCount ?? 0) > 0) {
    return {
      canProceed: false,
      reason: `Pipeline gate rejected: Revenue ingestion log reports ${latestSyncLog.unsplitCount} unsplit/unresolved records. Split calculation is incomplete.`,
      details: {
        lastDayDate: lastDayStr,
        totalExpectedDays: totalDaysInMonth,
        successfulDaysCount,
        missingDays,
        runningDays,
        failedDays,
        pendingSplitsCount: latestSyncLog.unsplitCount,
        latestSyncStatus: latestSyncLog.status,
        latestSyncRunAt: new Date(latestSyncLog.runAt).toISOString(),
      },
    };
  }

  return {
    canProceed: true,
    details: {
      lastDayDate: lastDayStr,
      totalExpectedDays: totalDaysInMonth,
      successfulDaysCount,
      missingDays: [],
      runningDays: [],
      failedDays: [],
      pendingSplitsCount: 0,
      latestSyncStatus: latestSyncLog.status,
      latestSyncRunAt: new Date(latestSyncLog.runAt).toISOString(),
    },
  };
}

// =============================================================================
// SCHEDULING RECOVERY & BOUNDED RETRIES STATE
// =============================================================================

export interface GateFailureRecord {
  month: number;
  year: number;
  reason: string;
  attempt: number;
  maxAttempts: number;
  recordedAt: Date;
  willRetry: boolean;
}

const gateFailureRegistry = new Map<string, GateFailureRecord>();

export const recordGateFailure = (
  month: number,
  year: number,
  reason: string,
  attempt: number,
  maxAttempts: number
): GateFailureRecord => {
  const key = `${year}-${month}`;
  const willRetry = attempt < maxAttempts;
  const record: GateFailureRecord = {
    month,
    year,
    reason,
    attempt,
    maxAttempts,
    recordedAt: new Date(),
    willRetry,
  };
  gateFailureRegistry.set(key, record);
  return record;
};

export const getGateFailureRecord = (month: number, year: number): GateFailureRecord | null => {
  return gateFailureRegistry.get(`${year}-${month}`) || null;
};

/**
 * Emits structured operational alerts when the monthly settlement pipeline gate fails.
 */
export const alertGateFailure = (
  month: number,
  year: number,
  reason: string,
  attempt: number,
  maxAttempts: number
) => {
  const alertHeader = attempt >= maxAttempts
    ? `[IP Settlement Scheduler FATAL ALERT]`
    : `[IP Settlement Scheduler WARNING]`;

  console.error(
    `${alertHeader} Monthly settlement pipeline gate failure for ${resolveMonthName(month)} ${year} (Attempt ${attempt}/${maxAttempts}): ${reason}`
  );
};

// =============================================================================
// CORE SETTLEMENT PROCESSOR
// =============================================================================

/**
 * Processes, generates, persists, and emails the monthly settlement for an IP Party.
 * 
 * Strict Invariants:
 * 1. Zero queries to TransactionSplit.
 * 2. Accurate distinct monthly kiosk count calculated from persisted IpDailyGameKiosk entries.
 * 3. Commercial agreement must overlap the target settlement month.
 * 4. Authoritative persisted totalKioskCount used for PDF statements without max-game fallbacks.
 * 5. Durable, retry-safe email delivery using stable delivery identities.
 */
export async function processIpMonthlySettlement(
  organizationId: string,
  month: number,
  year: number
): Promise<IpSettlementWithDetails> {
  const { startDate, endDate } = getIstMonthBoundaries(month, year);

  // 1. Fetch IP Party Organization with agreements overlapping target month
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      ipProfile: { select: { id: true, legalName: true, pan: true, gstin: true, statementEmail: true } },
      ipAgreements: {
        select: { id: true, status: true, ipSharePct: true, companySharePct: true, effectiveFrom: true, effectiveTo: true },
        where: {
          status: { in: ['ACTIVE', 'TERMINATED'] },
          effectiveFrom: { lt: endDate },
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gte: startDate } },
          ],
        },
      },
    },
  });

  if (!org || org.type !== 'IP_PARTY') {
    throw new ApiError(404, `Organization ${organizationId} is not a registered IP_PARTY.`);
  }

  const recipientEmail = org.ipProfile?.statementEmail || org.owner?.email;
  if (!recipientEmail) {
    throw new ApiError(400, `No recipient email found for IP Party ${org.name} (${organizationId}).`);
  }

  // 2. IDEMPOTENCY CHECK: Check if settlement already exists in database
  let settlement = await db.ipSettlement.findUnique({
    where: {
      organizationId_month_year: {
        organizationId,
        month,
        year,
      },
    },
    include: {
      lines: true,
      organization: {
        include: {
          owner: true,
          ipProfile: true,
        },
      },
    },
  });

  // 3. If NO settlement exists, verify agreement overlap eligibility and aggregate
  if (!settlement) {
    // Commercial Agreement Overlap Check
    if (!org.ipAgreements || org.ipAgreements.length === 0) {
      throw new ApiError(
        400,
        `Organization ${org.name} (${organizationId}) had no active or effective commercial agreement overlapping ${resolveMonthName(month)} ${year}.`
      );
    }

    // A. Query daily game revenue records for the target month
    const dailySnapshots = await db.ipDailyGameRevenue.findMany({
      where: {
        organizationId,
        businessDate: {
          gte: startDate,
          lt: endDate,
        },
      },
      select: {
        ipGameId: true,
        gameIdentifier: true,
        gameDisplayName: true,
        kioskCount: true,
        grossRevenue: true,
        gstAmount: true,
        pgFeeAmount: true,
        networkShare: true,
        companyShareBeforeRoyalty: true,
        ipRoyaltyShare: true,
      },
    });

    // B. Query distinct daily kiosks recorded in IpDailyGameKiosk for this month
    let monthlyKiosks: { gameIdentifier: string; kioskId: string }[] = [];
    if (db.ipDailyGameKiosk) {
      monthlyKiosks = await db.ipDailyGameKiosk.findMany({
        where: {
          organizationId,
          businessDate: {
            gte: startDate,
            lt: endDate,
          },
        },
        select: {
          gameIdentifier: true,
          kioskId: true,
        },
      });
    }

    // C. Group by gameIdentifier and aggregate
    const gameGroups = new Map<
      string,
      {
        ipGameId: string | null;
        gameIdentifier: string;
        gameDisplayName: string;
        grossRevenue: Prisma.Decimal;
        gstAmount: Prisma.Decimal;
        pgFeeAmount: Prisma.Decimal;
        networkShare: Prisma.Decimal;
        companyShareBeforeRoyalty: Prisma.Decimal;
        ipRoyaltyShare: Prisma.Decimal;
      }
    >();

    for (const snap of dailySnapshots) {
      const key = snap.gameIdentifier;
      let group = gameGroups.get(key);
      if (!group) {
        group = {
          ipGameId: snap.ipGameId,
          gameIdentifier: snap.gameIdentifier,
          gameDisplayName: snap.gameDisplayName || snap.gameIdentifier,
          grossRevenue: new Prisma.Decimal(0),
          gstAmount: new Prisma.Decimal(0),
          pgFeeAmount: new Prisma.Decimal(0),
          networkShare: new Prisma.Decimal(0),
          companyShareBeforeRoyalty: new Prisma.Decimal(0),
          ipRoyaltyShare: new Prisma.Decimal(0),
        };
        gameGroups.set(key, group);
      }

      group.grossRevenue = group.grossRevenue.add(toDecimal(snap.grossRevenue));
      group.gstAmount = group.gstAmount.add(toDecimal(snap.gstAmount));
      group.pgFeeAmount = group.pgFeeAmount.add(toDecimal(snap.pgFeeAmount));
      group.networkShare = group.networkShare.add(toDecimal(snap.networkShare));
      group.companyShareBeforeRoyalty = group.companyShareBeforeRoyalty.add(toDecimal(snap.companyShareBeforeRoyalty));
      group.ipRoyaltyShare = group.ipRoyaltyShare.add(toDecimal(snap.ipRoyaltyShare));
    }

    // D. Compute exact distinct kiosks per game and overall across the month
    const distinctKiosksPerGame = new Map<string, Set<string>>();
    const overallDistinctKiosks = new Set<string>();

    for (const entry of monthlyKiosks) {
      if (!distinctKiosksPerGame.has(entry.gameIdentifier)) {
        distinctKiosksPerGame.set(entry.gameIdentifier, new Set<string>());
      }
      distinctKiosksPerGame.get(entry.gameIdentifier)!.add(entry.kioskId);
      overallDistinctKiosks.add(entry.kioskId);
    }

    let totalGrossRevenue = new Prisma.Decimal(0);
    let totalGstAmount = new Prisma.Decimal(0);
    let totalPgFeeAmount = new Prisma.Decimal(0);
    let totalNetworkShare = new Prisma.Decimal(0);
    let totalCompanyShareBeforeRoyalty = new Prisma.Decimal(0);
    let totalIpRoyaltyShare = new Prisma.Decimal(0);

    const linesData: {
      ipGameId: string | null;
      gameIdentifier: string;
      gameDisplayName: string;
      kioskCount: number;
      grossRevenue: string;
      gstAmount: string;
      pgFeeAmount: string;
      networkShare: string;
      companyShareBeforeRoyalty: string;
      ipRoyaltyShare: string;
    }[] = [];

    for (const group of Array.from(gameGroups.values())) {
      const gameKiosks = distinctKiosksPerGame.get(group.gameIdentifier);
      const gameKioskCount = gameKiosks ? gameKiosks.size : 0;

      linesData.push({
        ipGameId: group.ipGameId,
        gameIdentifier: group.gameIdentifier,
        gameDisplayName: group.gameDisplayName,
        kioskCount: gameKioskCount,
        grossRevenue: group.grossRevenue.toFixed(2),
        gstAmount: group.gstAmount.toFixed(2),
        pgFeeAmount: group.pgFeeAmount.toFixed(2),
        networkShare: group.networkShare.toFixed(2),
        companyShareBeforeRoyalty: group.companyShareBeforeRoyalty.toFixed(2),
        ipRoyaltyShare: group.ipRoyaltyShare.toFixed(2),
      });

      totalGrossRevenue = totalGrossRevenue.add(group.grossRevenue);
      totalGstAmount = totalGstAmount.add(group.gstAmount);
      totalPgFeeAmount = totalPgFeeAmount.add(group.pgFeeAmount);
      totalNetworkShare = totalNetworkShare.add(group.networkShare);
      totalCompanyShareBeforeRoyalty = totalCompanyShareBeforeRoyalty.add(group.companyShareBeforeRoyalty);
      totalIpRoyaltyShare = totalIpRoyaltyShare.add(group.ipRoyaltyShare);
    }

    const totalKioskCount = overallDistinctKiosks.size;
    const finalPayout = totalIpRoyaltyShare;

    // E. Persist settlement header and lines in a single database transaction
    try {
      settlement = await (prisma as unknown as ExtendedPrismaClient).$transaction(async (tx: ExtendedPrismaClient) => {
        const createdHeader = await tx.ipSettlement.create({
          data: {
            organizationId,
            month,
            year,
            grossRevenue: totalGrossRevenue.toFixed(2),
            gstAmount: totalGstAmount.toFixed(2),
            pgFeeAmount: totalPgFeeAmount.toFixed(2),
            networkShare: totalNetworkShare.toFixed(2),
            companyShareBeforeRoyalty: totalCompanyShareBeforeRoyalty.toFixed(2),
            ipRoyaltyShare: totalIpRoyaltyShare.toFixed(2),
            totalKioskCount,
            finalPayout: finalPayout.toFixed(2),
            status: 'GENERATED',
            lines: {
              create: linesData.map((line) => ({
                ipGameId: line.ipGameId,
                gameIdentifier: line.gameIdentifier,
                gameDisplayName: line.gameDisplayName,
                kioskCount: line.kioskCount,
                grossRevenue: line.grossRevenue,
                gstAmount: line.gstAmount,
                pgFeeAmount: line.pgFeeAmount,
                networkShare: line.networkShare,
                companyShareBeforeRoyalty: line.companyShareBeforeRoyalty,
                ipRoyaltyShare: line.ipRoyaltyShare,
              })),
            },
          },
          include: {
            lines: true,
            organization: {
              include: {
                owner: true,
                ipProfile: true,
              },
            },
          },
        });
        return createdHeader;
      });
    } catch (dbErr: any) {
      if (dbErr.code === 'P2002') {
        console.warn(`[IP Settlement] Concurrent worker already created settlement for org ${organizationId}. Fetching existing...`);
        settlement = await db.ipSettlement.findUnique({
          where: {
            organizationId_month_year: {
              organizationId,
              month,
              year,
            },
          },
          include: {
            lines: true,
            organization: {
              include: {
                owner: true,
                ipProfile: true,
              },
            },
          },
        });
      } else {
        throw dbErr;
      }
    }
  }

  if (!settlement) {
    throw new ApiError(500, `Failed to load or persist settlement for org ${organizationId}.`);
  }

  // 4. PDF GENERATION OR RECOVERY
  let relativePdfPath = settlement.pdfPath;
  const absolutePdfPath = relativePdfPath
    ? path.join(process.cwd(), 'uploads', 'reports', relativePdfPath)
    : null;

  if (!relativePdfPath || !absolutePdfPath || !fs.existsSync(absolutePdfPath)) {
    console.log(`[IP Settlement] Generating PDF for ${org.name} (${month}/${year})...`);

    // Authoritative totalKioskCount verification: Never substitute max per-game count
    if (
      settlement.totalKioskCount === null ||
      settlement.totalKioskCount === undefined ||
      typeof settlement.totalKioskCount !== 'number' ||
      settlement.totalKioskCount < 0
    ) {
      throw new ApiError(
        500,
        `Settlement ${settlement.id} has invalid or missing persisted totalKioskCount: ${settlement.totalKioskCount}. Authoritative kiosk total is required for statement PDF generation.`
      );
    }

    const pdfRows: IpSettlementPdfRow[] = (settlement.lines || []).map((l: IpSettlementLineItem) => ({
      gameIdentifier: l.gameIdentifier,
      gameDisplayName: l.gameDisplayName,
      kioskCount: l.kioskCount,
      grossRevenue: Number(l.grossRevenue),
      gstAmount: Number(l.gstAmount),
      pgFeeAmount: Number(l.pgFeeAmount),
      networkShare: Number(l.networkShare),
      companyShareBeforeRoyalty: Number(l.companyShareBeforeRoyalty),
      ipRoyaltyShare: Number(l.ipRoyaltyShare),
    }));

    const reportConfig: IpSettlementReportConfig = {
      organizationName: org.name,
      legalName: org.ipProfile?.legalName,
      pan: org.ipProfile?.pan,
      gstin: org.ipProfile?.gstin,
      month,
      year,
      totalKioskCount: settlement.totalKioskCount,
      totalGrossRevenue: Number(settlement.grossRevenue),
      totalGstAmount: Number(settlement.gstAmount),
      totalPgFeeAmount: Number(settlement.pgFeeAmount),
      totalNetworkShare: Number(settlement.networkShare),
      totalCompanyShareBeforeRoyalty: Number(settlement.companyShareBeforeRoyalty),
      totalIpRoyaltyShare: Number(settlement.ipRoyaltyShare),
      finalPayout: Number(settlement.finalPayout ?? settlement.ipRoyaltyShare),
      rows: pdfRows,
    };

    relativePdfPath = await generateIpSettlementPdf(reportConfig);

    await db.ipSettlement.update({
      where: { id: settlement.id },
      data: { pdfPath: relativePdfPath },
    });
    settlement.pdfPath = relativePdfPath;
  }

  // 5. DURABLE RETRY-SAFE EMAIL DELIVERY
  if (settlement.emailDeliveredAt) {
    console.log(
      `[IP Settlement] Statement for ${org.name} (${month}/${year}) was already delivered on ${new Date(settlement.emailDeliveredAt).toISOString()}. Skipping duplicate email.`
    );
    return settlement;
  }

  // Stable delivery identity based on settlement ID and delivery purpose
  const deliveryIdentity = `ip-settlement:${settlement.id}:statement`;

  // Verify whether the provider already accepted this stable delivery identity (eliminates the crash window)
  let alreadyDispatchedAt: Date | null = null;
  if (emailSender.checkDelivery) {
    try {
      const checkResult = await emailSender.checkDelivery(deliveryIdentity);
      if (checkResult?.delivered) {
        console.log(
          `[IP Settlement] Provider confirmed existing delivery for identity '${deliveryIdentity}'. Healing database delivery timestamp without duplicate send.`
        );
        alreadyDispatchedAt = checkResult.deliveredAt || new Date();
      }
    } catch (checkErr) {
      console.warn(`[IP Settlement] Provider delivery inquiry failed. Falling back to delivery pipeline:`, checkErr);
    }
  }

  if (!alreadyDispatchedAt) {
    const pdfFullPath = path.join(process.cwd(), 'uploads', 'reports', relativePdfPath!);
    if (!fs.existsSync(pdfFullPath)) {
      throw new ApiError(500, `Generated PDF file not found at ${pdfFullPath}. Email aborted.`);
    }

    const pdfBuffer = fs.readFileSync(pdfFullPath);

    console.log(
      `[IP Settlement] Dispatching settlement email to ${recipientEmail} for ${org.name} (${month}/${year}) [Identity: ${deliveryIdentity}]...`
    );

    await emailSender.send({
      to: recipientEmail,
      toName: org.name,
      customId: deliveryIdentity,
      subject: `ArcadeLX Monthly Revenue Settlement: ${resolveMonthName(month)} ${year} — ${org.name}`,
      text: `Please find attached your official IP Royalty Revenue Statement for the period of ${resolveMonthName(month)} ${year}. Total royalty payout: Rs. ${Number(settlement.ipRoyaltyShare).toFixed(2)}.`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #1f2937;">
          <h2 style="color: #111827; margin-bottom: 8px;">Monthly Revenue Settlement Generated</h2>
          <p>Dear <strong>${org.name}</strong>,</p>
          <p>Please find attached your official IP Royalty Revenue Statement for the period of <strong>${resolveMonthName(month)} ${year}</strong>.</p>
          
          <table style="width: 100%; max-width: 450px; margin: 16px 0; border-collapse: collapse; font-size: 14px;">
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 6px 0; color: #4b5563;">Period:</td>
              <td style="padding: 6px 0; font-weight: bold; text-align: right;">${resolveMonthName(month)} ${year}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 6px 0; color: #4b5563;">Active Kiosks:</td>
              <td style="padding: 6px 0; font-weight: bold; text-align: right;">${settlement.totalKioskCount || 0}</td>
            </tr>
            <tr style="border-bottom: 1px solid #e5e7eb;">
              <td style="padding: 6px 0; color: #4b5563;">Gross Revenue:</td>
              <td style="padding: 6px 0; font-weight: bold; text-align: right;">Rs. ${Number(settlement.grossRevenue).toFixed(2)}</td>
            </tr>
            <tr style="border-bottom: 2px solid #10b981;">
              <td style="padding: 8px 0; color: #047857; font-weight: bold;">Your Royalty Share:</td>
              <td style="padding: 8px 0; color: #047857; font-weight: bold; text-align: right; font-size: 16px;">Rs. ${Number(settlement.ipRoyaltyShare).toFixed(2)}</td>
            </tr>
          </table>

          <p>Please raise an invoice matching your royalty share to initiate payout processing.</p>
          <p style="font-size: 12px; color: #6b7280; margin-top: 24px;">If you have any questions regarding your statement, please reply directly to this email or reach out to your ArcadeLX account manager.</p>
        </div>
      `,
      attachment: {
        filename: path.basename(pdfFullPath),
        base64Content: pdfBuffer.toString('base64'),
        contentType: 'application/pdf',
      },
    });

    alreadyDispatchedAt = new Date();
  }

  // Update settlement email delivery timestamp
  await db.ipSettlement.update({
    where: { id: settlement.id },
    data: {
      emailDeliveredAt: alreadyDispatchedAt,
    },
  });

  settlement.emailDeliveredAt = alreadyDispatchedAt;
  console.log(`[IP Settlement] Successfully processed, persisted, and emailed settlement for ${org.name}.`);

  return settlement;
}

// =============================================================================
// CENTRALIZED SCHEDULER & BOUNDED RETRY ORCHESTRATION
// =============================================================================

export interface TriggerSettlementsOptions {
  force?: boolean;
  attempt?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

export async function triggerMonthlyIpSettlements(
  month: number,
  year: number,
  options?: TriggerSettlementsOptions
): Promise<{
  success: boolean;
  status: 'GATE_FAILED' | 'QUEUED' | 'ALREADY_COMPLETED';
  reason?: string;
  attempt: number;
  maxRetries: number;
  willRetry: boolean;
  partiesQueued: number;
  totalParties: number;
  jobIds: string[];
}> {
  const attempt = options?.attempt ?? 1;
  const maxRetries = options?.maxRetries ?? 5;
  const retryDelayMs = options?.retryDelayMs ?? 15 * 60 * 1000; // 15 minutes default

  console.log(
    `[IP Settlement Scheduler] Initiating monthly settlements for ${resolveMonthName(month)} ${year} (Attempt ${attempt}/${maxRetries})...`
  );

  // 1. Pipeline Completion Gate check
  if (!options?.force) {
    const gate = await checkMonthlyPipelineGate(month, year);
    if (!gate.canProceed) {
      const reason = gate.reason || 'Pipeline gate check failed.';
      recordGateFailure(month, year, reason, attempt, maxRetries);
      alertGateFailure(month, year, reason, attempt, maxRetries);

      // Bounded retry scheduling
      const willRetry = attempt < maxRetries;
      if (willRetry) {
        const nextAttempt = attempt + 1;
        console.log(
          `[IP Settlement Scheduler] Scheduling bounded gate retry attempt ${nextAttempt}/${maxRetries} in ${Math.round(retryDelayMs / 1000)}s...`
        );

        try {
          await ipSettlementQueue.add(
            'gate-retry',
            {
              organizationId: '__scheduler_gate_retry__',
              month,
              year,
              attempt: nextAttempt,
              maxAttempts: maxRetries,
            },
            {
              delay: retryDelayMs,
              jobId: `ip-settlement-gate-retry-${year}-${month}-${nextAttempt}`,
              removeOnComplete: true,
            }
          );
        } catch (queueErr) {
          console.error(`[IP Settlement Scheduler] Failed to enqueue gate retry job:`, queueErr);
        }
      } else {
        console.error(
          `[IP Settlement Scheduler FATAL] Exhausted all ${maxRetries} bounded retry attempts for ${month}/${year}. Settlements will not run until manual resolution.`
        );
      }

      return {
        success: false,
        status: 'GATE_FAILED',
        reason,
        attempt,
        maxRetries,
        willRetry,
        partiesQueued: 0,
        totalParties: 0,
        jobIds: [],
      };
    }
    console.log(`[IP Settlement Scheduler] Gate check passed successfully.`);
  } else {
    console.warn(`[IP Settlement Scheduler] Force option specified. Bypassing upstream pipeline gate.`);
  }

  const { startDate, endDate } = getIstMonthBoundaries(month, year);

  // 2. Fetch all eligible IP Parties: Commercial agreement must overlap target month
  const ipParties = await db.organization.findMany({
    where: {
      type: 'IP_PARTY',
      ipAgreements: {
        some: {
          status: { in: ['ACTIVE', 'TERMINATED'] },
          effectiveFrom: { lt: endDate },
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gte: startDate } },
          ],
        },
      },
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (ipParties.length === 0) {
    console.log(`[IP Settlement Scheduler] No eligible IP Parties with overlapping agreements found for ${month}/${year}.`);
    return {
      success: true,
      status: 'QUEUED',
      attempt,
      maxRetries,
      willRetry: false,
      partiesQueued: 0,
      totalParties: 0,
      jobIds: [],
    };
  }

  const jobIds: string[] = [];

  // 3. Queue one BullMQ job per eligible IP Party with deterministic Job ID
  for (const party of ipParties) {
    const deterministicJobId = `ip-settlement-${party.id}-${year}-${month}`;

    try {
      await ipSettlementQueue.add(
        'generate-ip-settlement',
        {
          organizationId: party.id,
          month,
          year,
        },
        {
          jobId: deterministicJobId,
        }
      );
      jobIds.push(deterministicJobId);
    } catch (err: any) {
      console.error(`[IP Settlement Scheduler] Failed to enqueue job for party ${party.id}:`, err);
    }
  }

  console.log(
    `[IP Settlement Scheduler] Successfully queued ${jobIds.length}/${ipParties.length} IP settlement jobs for ${resolveMonthName(month)} ${year}.`
  );

  return {
    success: true,
    status: 'QUEUED',
    attempt,
    maxRetries,
    willRetry: false,
    partiesQueued: jobIds.length,
    totalParties: ipParties.length,
    jobIds,
  };
}
