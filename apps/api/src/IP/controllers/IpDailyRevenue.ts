import type { Request, Response } from 'express';
import { prisma } from '../../utils/db';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiResponse } from '../../utils/ApiResponse';
import { ApiError } from '../../utils/ApiError';
import { Prisma } from '../../generated/prisma/client';
import {
  getPreviousCompletedIstDate,
  formatIstDate,
  parseIstDateString,
  toDecimal,
  runDailyRevenueAggregation,
  type ExtendedPrismaClient,
} from '../../services/Revenue/ipDailyRevenue.service';
import '../../middlewares/auth';

const db = prisma as unknown as ExtendedPrismaClient;

/**
 * IP DASHBOARD:
 * Read-only endpoint for an authenticated IP Party to view its daily revenue.
 *
 * GET /api/ip/revenue/daily?date=YYYY-MM-DD
 *
 * Allowed: IP_PARTY members only (strictly scoped to their own organization in session).
 */
export const getIpDailyRevenue = asyncHandler(async (req: Request, res: Response) => {
  const currentOrgType = req.membership?.type;
  const currentOrgId = req.membership?.organizationId;

  if (currentOrgType !== 'IP_PARTY') {
    throw new ApiError(403, 'Only IP Party members can access this endpoint');
  }

  if (!currentOrgId) {
    throw new ApiError(403, 'No active organization found in session');
  }

  // 1. Determine and strictly validate target business date
  const dateQuery = req.query.date as string | undefined;
  let targetDate: Date;

  if (dateQuery !== undefined) {
    if (typeof dateQuery !== 'string' || dateQuery.trim() === '') {
      throw new ApiError(400, 'Invalid date query parameter. Expected YYYY-MM-DD');
    }
    targetDate = parseIstDateString(dateQuery.trim());
  } else {
    targetDate = getPreviousCompletedIstDate();
  }

  const formattedDate = formatIstDate(targetDate);

  // 2. Fetch daily snapshots from persisted table (IpDailyGameRevenue)
  const dailyRows = await db.ipDailyGameRevenue.findMany({
    where: {
      organizationId: currentOrgId,
      businessDate: targetDate,
    },
    select: {
      id: true,
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
      createdAt: true,
      updatedAt: true,
    },
    orderBy: {
      grossRevenue: 'desc',
    },
  });

  // 3. Retrieve overall distinct physical kiosk count directly from persisted daily party summary
  // Ensures snapshot-only reads with ZERO live transaction-level aggregation during API requests.
  let totalKioskCount = 0;
  const partySummary = await db.ipDailyPartySummary.findUnique({
    where: {
      organizationId_businessDate: {
        organizationId: currentOrgId,
        businessDate: targetDate,
      },
    },
    select: {
      kioskCount: true,
    },
  });

  if (partySummary) {
    totalKioskCount = partySummary.kioskCount;
  }

  // 4. Compute summary totals using exact Decimal arithmetic
  let totalGrossRevenue = new Prisma.Decimal(0);
  let totalGstAmount = new Prisma.Decimal(0);
  let totalPgFeeAmount = new Prisma.Decimal(0);
  let totalNetworkShare = new Prisma.Decimal(0);
  let totalCompanyShareBeforeRoyalty = new Prisma.Decimal(0);
  let totalIpRoyaltyShare = new Prisma.Decimal(0);

  const games = dailyRows.map((row: any) => {
    const gross = toDecimal(row.grossRevenue);
    const gst = toDecimal(row.gstAmount);
    const pg = toDecimal(row.pgFeeAmount);
    const network = toDecimal(row.networkShare);
    const company = toDecimal(row.companyShareBeforeRoyalty);
    const ipRoyalty = toDecimal(row.ipRoyaltyShare);
    const kiosks = Number(row.kioskCount || 0);

    totalGrossRevenue = totalGrossRevenue.add(gross);
    totalGstAmount = totalGstAmount.add(gst);
    totalPgFeeAmount = totalPgFeeAmount.add(pg);
    totalNetworkShare = totalNetworkShare.add(network);
    totalCompanyShareBeforeRoyalty = totalCompanyShareBeforeRoyalty.add(company);
    totalIpRoyaltyShare = totalIpRoyaltyShare.add(ipRoyalty);

    return {
      gameId: row.ipGameId,
      gameIdentifier: row.gameIdentifier,
      displayName: row.gameDisplayName,
      kioskCount: kiosks,
      grossRevenue: gross.toFixed(2),
      gstAmount: gst.toFixed(2),
      pgFeeAmount: pg.toFixed(2),
      networkShare: network.toFixed(2),
      companyShareBeforeRoyalty: company.toFixed(2),
      ipRoyaltyShare: ipRoyalty.toFixed(2),
    };
  });

  // 5. Accurate aggregation status semantics (Never default to COMPLETED when no job has run)
  let aggregationStatus: string = 'NOT_RUN';
  let globalJobStatus: string | null = null;

  const jobRun = await db.ipDailyRevenueJobRun.findFirst({
    where: { businessDate: targetDate },
    orderBy: { createdAt: 'desc' },
    select: { status: true },
  });

  if (jobRun?.status) {
    globalJobStatus = jobRun.status;
  }

  if (dailyRows.length > 0) {
    aggregationStatus = 'AVAILABLE';
  } else if (jobRun) {
    if (jobRun.status === 'RUNNING') {
      aggregationStatus = 'IN_PROGRESS';
    } else if (jobRun.status === 'COMPLETED') {
      aggregationStatus = 'NO_REVENUE';
    } else if (jobRun.status === 'FAILED') {
      aggregationStatus = 'FAILED';
    } else if (jobRun.status === 'PARTIALLY_COMPLETED') {
      aggregationStatus = 'PARTIAL';
    }
  } else {
    aggregationStatus = 'NOT_RUN';
  }

  res.status(200).json(
    new ApiResponse(
      200,
      {
        businessDate: formattedDate,
        timezone: 'Asia/Kolkata',
        summary: {
          totalGrossRevenue: totalGrossRevenue.toFixed(2),  
          totalGstAmount: totalGstAmount.toFixed(2),
          totalPgFeeAmount: totalPgFeeAmount.toFixed(2),
          totalNetworkShare: totalNetworkShare.toFixed(2),
          totalCompanyShareBeforeRoyalty: totalCompanyShareBeforeRoyalty.toFixed(2),
          totalIpRoyaltyShare: totalIpRoyaltyShare.toFixed(2),
          totalKioskCount,
          totalGames: games.length,
        },
        games,
        aggregationStatus,
        globalJobStatus,
      },
      games.length === 0 ? 'No revenue recorded for the requested date' : 'Daily revenue retrieved successfully'
    )
  );
});

/**
 * COMPANY DASHBOARD:
 * View daily revenue for a specific selected IP Party.
 *
 * GET /api/ip/revenue/:ipOrgId/daily?date=YYYY-MM-DD
 *
 * Allowed: Company OWNER, ADMIN, MANAGER.
 */
export const getIpDailyRevenueForParty = asyncHandler(async (req: Request, res: Response) => {
  const currentOrgType = req.membership?.type;
  if (currentOrgType !== 'COMPANY') {
    throw new ApiError(403, 'Only the Company organization can view IP Party daily revenue');
  }

  const currentRole = req.membership?.role;
  if (!currentRole || !['OWNER', 'ADMIN', 'MANAGER'].includes(currentRole)) {
    throw new ApiError(403, 'Insufficient permissions to view IP Party daily revenue');
  }

  const currentCompanyOrgId = req.membership?.organizationId;

  const { ipOrgId } = req.params;
  const targetOrgId = ipOrgId || req.params.organizationId;

  if (!targetOrgId || typeof targetOrgId !== 'string') {
    throw new ApiError(400, 'Invalid IP organization ID');
  }

  // 1. Verify target organization exists and is an IP_PARTY with registered profile & agreement
  const ipOrg = await db.organization.findUnique({
    where: { id: targetOrgId },
    select: {
      id: true,
      name: true,
      type: true,
      ipProfile: { select: { id: true, sourceKey: true } },
      ipAgreements: {
        select: {
          id: true,
          companyOrganizationId: true,
          status: true,
          effectiveFrom: true,
          effectiveTo: true,
        },
      },
    },
  });

  if (!ipOrg || (ipOrg.type as any) !== 'IP_PARTY' || !ipOrg.ipProfile) {
    throw new ApiError(404, 'IP Party organization not found');
  }

  // 2. Explicitly verify agreement is associated with the current Company organization ID
  // Allows historical access through valid terminated agreements
  const companyAgreements = ipOrg.ipAgreements?.filter((a: any) => {
    const isStatusValid = a.status === 'ACTIVE' || a.status === 'TERMINATED';
    const isCompanyAssociated = a.companyOrganizationId
      ? a.companyOrganizationId === currentCompanyOrgId
      : true; // fallback for pre-existing records created before companyOrganizationId column
    return isStatusValid && isCompanyAssociated;
  });

  if (!companyAgreements || companyAgreements.length === 0) {
    throw new ApiError(403, 'Target IP Party does not have a registered commercial agreement with this Company');
  }

  // 3. Determine target business date
  const dateQuery = req.query.date as string | undefined;
  let targetDate: Date;

  if (dateQuery !== undefined) {
    if (typeof dateQuery !== 'string' || dateQuery.trim() === '') {
      throw new ApiError(400, 'Invalid date query parameter. Expected YYYY-MM-DD');
    }
    targetDate = parseIstDateString(dateQuery.trim());
  } else {
    targetDate = getPreviousCompletedIstDate();
  }

  const formattedDate = formatIstDate(targetDate);

  // 4. Fetch daily snapshots
  const dailyRows = await db.ipDailyGameRevenue.findMany({
    where: {
      organizationId: targetOrgId,
      businessDate: targetDate,
    },
    select: {
      id: true,
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
    orderBy: {
      grossRevenue: 'desc',
    },
  });

  // 5. Retrieve overall distinct physical kiosk count directly from persisted daily party summary
  // Ensures snapshot-only reads with ZERO live transaction-level aggregation during API requests.
  let totalKioskCount = 0;
  const partySummary = await db.ipDailyPartySummary.findUnique({
    where: {
      organizationId_businessDate: {
        organizationId: targetOrgId,
        businessDate: targetDate,
      },
    },
    select: {
      kioskCount: true,
    },
  });

  if (partySummary) {
    totalKioskCount = partySummary.kioskCount;
  }

  // 6. Compute summary totals using exact Decimal arithmetic
  let totalGrossRevenue = new Prisma.Decimal(0);
  let totalGstAmount = new Prisma.Decimal(0);
  let totalPgFeeAmount = new Prisma.Decimal(0);
  let totalNetworkShare = new Prisma.Decimal(0);
  let totalCompanyShareBeforeRoyalty = new Prisma.Decimal(0);
  let totalIpRoyaltyShare = new Prisma.Decimal(0);

  const games = dailyRows.map((row: any) => {
    const gross = toDecimal(row.grossRevenue);
    const gst = toDecimal(row.gstAmount);
    const pg = toDecimal(row.pgFeeAmount);
    const network = toDecimal(row.networkShare);
    const company = toDecimal(row.companyShareBeforeRoyalty);
    const ipRoyalty = toDecimal(row.ipRoyaltyShare);
    const kiosks = Number(row.kioskCount || 0);

    totalGrossRevenue = totalGrossRevenue.add(gross);
    totalGstAmount = totalGstAmount.add(gst);
    totalPgFeeAmount = totalPgFeeAmount.add(pg);
    totalNetworkShare = totalNetworkShare.add(network);
    totalCompanyShareBeforeRoyalty = totalCompanyShareBeforeRoyalty.add(company);
    totalIpRoyaltyShare = totalIpRoyaltyShare.add(ipRoyalty);

    return {
      gameId: row.ipGameId,
      gameIdentifier: row.gameIdentifier,
      displayName: row.gameDisplayName,
      kioskCount: kiosks,
      grossRevenue: gross.toFixed(2),
      gstAmount: gst.toFixed(2),
      pgFeeAmount: pg.toFixed(2),
      networkShare: network.toFixed(2),
      companyShareBeforeRoyalty: company.toFixed(2),
      ipRoyaltyShare: ipRoyalty.toFixed(2),
    };
  });

  // 7. Aggregation status
  let aggregationStatus: string = 'NOT_RUN';
  let globalJobStatus: string | null = null;

  const jobRun = await db.ipDailyRevenueJobRun.findFirst({
    where: { businessDate: targetDate },
    orderBy: { createdAt: 'desc' },
    select: { status: true },
  });

  if (jobRun?.status) {
    globalJobStatus = jobRun.status;
  }

  if (dailyRows.length > 0) {
    aggregationStatus = 'AVAILABLE';
  } else if (jobRun) {
    if (jobRun.status === 'RUNNING') {
      aggregationStatus = 'IN_PROGRESS';
    } else if (jobRun.status === 'COMPLETED') {
      aggregationStatus = 'NO_REVENUE';
    } else if (jobRun.status === 'FAILED') {
      aggregationStatus = 'FAILED';
    } else if (jobRun.status === 'PARTIALLY_COMPLETED') {
      aggregationStatus = 'PARTIAL';
    }
  } else {
    aggregationStatus = 'NOT_RUN';
  }

  res.status(200).json(
    new ApiResponse(
      200,
      {
        organization: {
          id: ipOrg.id,
          name: ipOrg.name,
        },
        businessDate: formattedDate,
        timezone: 'Asia/Kolkata',
        summary: {
          totalGrossRevenue: totalGrossRevenue.toFixed(2),
          totalGstAmount: totalGstAmount.toFixed(2),
          totalPgFeeAmount: totalPgFeeAmount.toFixed(2),
          totalNetworkShare: totalNetworkShare.toFixed(2),
          totalCompanyShareBeforeRoyalty: totalCompanyShareBeforeRoyalty.toFixed(2),
          totalIpRoyaltyShare: totalIpRoyaltyShare.toFixed(2),
          totalKioskCount,
          totalGames: games.length,
        },
        games,
        aggregationStatus,
        globalJobStatus,
      },
      games.length === 0 ? 'No revenue recorded for the requested date' : 'IP Party daily revenue retrieved successfully'
    )
  );
});

/**
 * COMPANY DASHBOARD / INTERNAL TRIGGER:
 * On-demand trigger to aggregate or reconcile daily revenue for a specific date.
 *
 * POST /api/ip/revenue/daily/aggregate
 *
 * Allowed: Company OWNER, ADMIN only.
 * Critical: TESTING ONLY , NOT IN PRODUCTION
 */
export const triggerDailyRevenueAggregation = asyncHandler(async (req: Request, res: Response) => {
  const currentOrgType = req.membership?.type;

  if (currentOrgType !== 'COMPANY') {
    throw new ApiError(403, 'Only the Company organization can trigger daily revenue aggregation');
  }

  const currentRole = req.membership?.role;
  if (!currentRole || !['OWNER', 'ADMIN'].includes(currentRole)) {
    throw new ApiError(403, 'Insufficient permissions to trigger daily revenue aggregation');
  }

  let targetDate: Date | undefined;
  if (req.body.date !== undefined) {
    if (typeof req.body.date !== 'string' || req.body.date.trim() === '') {
      throw new ApiError(400, 'Invalid date. Expected YYYY-MM-DD');
    }
    targetDate = parseIstDateString(req.body.date.trim());
  }

  let lookbackDays = 0;
  if (req.body.lookbackDays !== undefined) {
    if (!Number.isInteger(req.body.lookbackDays) || req.body.lookbackDays < 0) {
      throw new ApiError(400, 'lookbackDays must be a non-negative integer');
    }
    lookbackDays = req.body.lookbackDays;
  }

  const result = await runDailyRevenueAggregation({
    targetDate,
    lookbackDays,
  });

  if (result.status === 'BLOCKED') {
    throw new ApiError(
      409,
      result.errors[0] || 'An aggregation job is already actively running for the requested business date'
    );
  }

  res.status(200).json(
    new ApiResponse(200, result, `Daily revenue aggregation completed with status: ${result.status}`)
  );
});
