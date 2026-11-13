import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../utils/db';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiResponse } from '../../utils/ApiResponse';
import { ApiError } from '../../utils/ApiError';
import { triggerMonthlyIpSettlements } from '../../services/Revenue/ipSettlement.service';

const db = prisma as any;

/**
 * IP DASHBOARD:
 * List monthly revenue settlements for the authenticated IP Party.
 *
 * GET /api/ip/settlements?year=2026&page=1&limit=12
 */
export const getIpSettlements = asyncHandler(async (req: Request, res: Response) => {
  const currentOrgType = req.membership?.type;
  const currentOrgId = req.membership?.organizationId;

  if (currentOrgType !== 'IP_PARTY' || !currentOrgId) {
    throw new ApiError(403, 'Only IP Party organizations can access IP settlements');
  }

  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt((req.query.limit as string) || '12', 10)));
  const skip = (page - 1) * limit;

  const yearQuery = req.query.year ? parseInt(req.query.year as string, 10) : undefined;

  const whereClause: any = {
    organizationId: currentOrgId,
  };

  if (yearQuery && !isNaN(yearQuery)) {
    whereClause.year = yearQuery;
  }

  const [totalCount, settlements] = await Promise.all([
    db.ipSettlement.count({ where: whereClause }),
    db.ipSettlement.findMany({
      where: whereClause,
      select: {
        id: true,
        month: true,
        year: true,
        grossRevenue: true,
        gstAmount: true,
        pgFeeAmount: true,
        networkShare: true,
        companyShareBeforeRoyalty: true,
        ipRoyaltyShare: true,
        totalKioskCount: true,
        finalPayout: true,
        status: true,
        pdfPath: true,
        emailDeliveredAt: true,
        createdAt: true,
        _count: {
          select: { lines: true },
        },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      skip,
      take: limit,
    }),
  ]);

  const formattedSettlements = settlements.map((s: any) => ({
    id: s.id,
    month: s.month,
    year: s.year,
    grossRevenue: Number(s.grossRevenue).toFixed(2),
    gstAmount: Number(s.gstAmount).toFixed(2),
    pgFeeAmount: Number(s.pgFeeAmount).toFixed(2),
    networkShare: Number(s.networkShare).toFixed(2),
    companyShareBeforeRoyalty: Number(s.companyShareBeforeRoyalty).toFixed(2),
    ipRoyaltyShare: Number(s.ipRoyaltyShare).toFixed(2),
    totalKioskCount: s.totalKioskCount || 0,
    finalPayout: Number(s.finalPayout ?? s.ipRoyaltyShare).toFixed(2),
    status: s.status,
    hasPdf: Boolean(s.pdfPath),
    emailDeliveredAt: s.emailDeliveredAt,
    linesCount: s._count?.lines || 0,
    createdAt: s.createdAt,
  }));

  res.status(200).json(
    new ApiResponse(
      200,
      {
        settlements: formattedSettlements,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit),
        },
      },
      'IP Settlements fetched successfully'
    )
  );
});

/**
 * IP DASHBOARD:
 * Get detailed view of a single monthly settlement with game lines.
 *
 * GET /api/ip/settlements/:id
 */
export const getIpSettlementById = asyncHandler(async (req: Request, res: Response) => {
  const currentOrgType = req.membership?.type;
  const currentOrgId = req.membership?.organizationId;

  if (currentOrgType !== 'IP_PARTY' || !currentOrgId) {
    throw new ApiError(403, 'Only IP Party organizations can access IP settlements');
  }

  const { id } = req.params;
  if (!id) {
    throw new ApiError(400, 'Settlement ID is required');
  }

  const settlement = await db.ipSettlement.findUnique({
    where: { id },
    include: {
      lines: {
        orderBy: { grossRevenue: 'desc' },
      },
    },
  });

  if (!settlement || settlement.organizationId !== currentOrgId) {
    throw new ApiError(404, 'Monthly settlement not found');
  }

  const formattedLines = settlement.lines.map((l: any) => ({
    id: l.id,
    ipGameId: l.ipGameId,
    gameIdentifier: l.gameIdentifier,
    gameDisplayName: l.gameDisplayName,
    kioskCount: l.kioskCount,
    grossRevenue: Number(l.grossRevenue).toFixed(2),
    gstAmount: Number(l.gstAmount).toFixed(2),
    pgFeeAmount: Number(l.pgFeeAmount).toFixed(2),
    networkShare: Number(l.networkShare).toFixed(2),
    companyShareBeforeRoyalty: Number(l.companyShareBeforeRoyalty).toFixed(2),
    ipRoyaltyShare: Number(l.ipRoyaltyShare).toFixed(2),
  }));

  res.status(200).json(
    new ApiResponse(
      200,
      {
        settlement: {
          id: settlement.id,
          month: settlement.month,
          year: settlement.year,
          grossRevenue: Number(settlement.grossRevenue).toFixed(2),
          gstAmount: Number(settlement.gstAmount).toFixed(2),
          pgFeeAmount: Number(settlement.pgFeeAmount).toFixed(2),
          networkShare: Number(settlement.networkShare).toFixed(2),
          companyShareBeforeRoyalty: Number(settlement.companyShareBeforeRoyalty).toFixed(2),
          ipRoyaltyShare: Number(settlement.ipRoyaltyShare).toFixed(2),
          totalKioskCount: settlement.totalKioskCount || 0,
          finalPayout: Number(settlement.finalPayout ?? settlement.ipRoyaltyShare).toFixed(2),
          status: settlement.status,
          hasPdf: Boolean(settlement.pdfPath),
          emailDeliveredAt: settlement.emailDeliveredAt,
          createdAt: settlement.createdAt,
          lines: formattedLines,
        },
      },
      'Monthly settlement details fetched successfully'
    )
  );
});

/**
 * IP DASHBOARD:
 * Secure PDF Download endpoint.
 * Verifies tenant ownership before serving the PDF file.
 *
 * GET /api/ip/settlements/:id/download
 */
export const downloadIpSettlementPdf = asyncHandler(async (req: Request, res: Response) => {
  const currentOrgType = req.membership?.type;
  const currentOrgId = req.membership?.organizationId;

  if (currentOrgType !== 'IP_PARTY' || !currentOrgId) {
    throw new ApiError(403, 'Only IP Party organizations can download IP statements');
  }

  const { id } = req.params;
  const settlement = await db.ipSettlement.findUnique({
    where: { id },
  });

  if (!settlement || settlement.organizationId !== currentOrgId) {
    throw new ApiError(404, 'Monthly settlement not found');
  }

  if (!settlement.pdfPath) {
    throw new ApiError(404, 'PDF statement has not been generated for this settlement');
  }

  const absolutePdfPath = path.join(process.cwd(), 'uploads', 'reports', settlement.pdfPath);

  if (!fs.existsSync(absolutePdfPath)) {
    throw new ApiError(404, 'PDF file not found on server');
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(absolutePdfPath)}"`);

  const fileStream = fs.createReadStream(absolutePdfPath);
  fileStream.pipe(res);
});

/**
 * COMPANY DASHBOARD:
 * View monthly settlements for a specific IP Party.
 *
 * GET /api/ip/settlements/company/:ipOrgId
 */
export const getCompanyIpSettlements = asyncHandler(async (req: Request, res: Response) => {
  const currentOrgType = req.membership?.type;
  const currentCompanyOrgId = req.membership?.organizationId;

  if (currentOrgType !== 'COMPANY') {
    throw new ApiError(403, 'Only Company organization members can view IP settlements from company view');
  }

  const { ipOrgId } = req.params;
  if (!ipOrgId) {
    throw new ApiError(400, 'Target IP organization ID is required');
  }

  // Verify target IP Party exists and has commercial agreement with this Company
  const targetOrg = await db.organization.findUnique({
    where: { id: ipOrgId },
    select: {
      id: true,
      name: true,
      type: true,
      ipAgreements: {
        select: { id: true, companyOrganizationId: true, status: true },
      },
    },
  });

  if (!targetOrg || targetOrg.type !== 'IP_PARTY') {
    throw new ApiError(404, 'Target IP Party organization not found');
  }

  const hasValidAgreement = targetOrg.ipAgreements?.some((a: any) => {
    const isStatusValid = a.status === 'ACTIVE' || a.status === 'TERMINATED';
    const isCompanyAssociated = a.companyOrganizationId
      ? a.companyOrganizationId === currentCompanyOrgId
      : true;
    return isStatusValid && isCompanyAssociated;
  });

  if (!hasValidAgreement) {
    throw new ApiError(403, 'Target IP Party does not have a registered agreement with this Company');
  }

  const settlements = await db.ipSettlement.findMany({
    where: { organizationId: ipOrgId },
    include: {
      lines: true,
    },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });

  res.status(200).json(
    new ApiResponse(
      200,
      {
        organization: { id: targetOrg.id, name: targetOrg.name },
        settlements,
      },
      'IP Party settlements fetched successfully'
    )
  );
});

/**
 * COMPANY DASHBOARD:
 * Trigger monthly settlements manually for all eligible IP Parties.
 *
 * POST /api/ip/settlements/trigger
 * Body: { month: number, year: number, force?: boolean }
 * CRITICAL : FOR TESTING ONLY!!, RMEOVE IN PRODUCTION
 */
export const triggerMonthlySettlementsEndpoint = asyncHandler(async (req: Request, res: Response) => {
  const currentOrgType = req.membership?.type;
  const currentRole = req.membership?.role;

  if (currentOrgType !== 'COMPANY' || !currentRole || !['OWNER', 'ADMIN'].includes(currentRole)) {
    throw new ApiError(403, 'Only Company OWNER or ADMIN can manually trigger monthly settlements');
  }

  const { month, year, force } = req.body;
  if (!month || !year) {
    throw new ApiError(400, 'Month (1-12) and Year are required');
  }

  const result = await triggerMonthlyIpSettlements(Number(month), Number(year), { force: Boolean(force) });

  res.status(200).json(new ApiResponse(200, result, 'Monthly settlement trigger processed'));
});
