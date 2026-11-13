import { prisma } from '../../utils/db';
import { ApiError } from '../../utils/ApiError';

const db = prisma as any;

/**
 * Rounds a number to exactly two decimal places using EPSILON to avoid floating-point drift.
 */
export const round2 = (num: number): number => {
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

/**
 * Derives the IST (India Standard Time, UTC+5:30) business date as a UTC midnight Date.
 * PostgreSQL @db.Date expects a Date object representing the calendar date.
 */
export const getIstBusinessDate = (date: Date): Date => {
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const istTime = new Date(date.getTime() + istOffsetMs);
  return new Date(Date.UTC(istTime.getUTCFullYear(), istTime.getUTCMonth(), istTime.getUTCDate()));
};

/**
 * Normalizes incoming game identifiers (handling uppercase, spaces, underscores)
 * to match registered IpGame.gameIdentifier slugs.
 */
export const normalizeGameIdentifier = (raw: string): string => {
  if (!raw) return '';
  return raw.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
};

export interface SplitCalculationResult {
  totalProcessed: number;
  resolvedCount: number;
  unresolvedCount: number;
  failedCount: number;
}

export interface CalculatedSplitPayload {
  transactionId: string;
  businessDate: Date;
  grossAmount: string;
  gstAmount: string | null;
  pgFeeAmount: string | null;
  netAmount: string | null;
  distributorShare: string | null;
  partnerShare: string | null;
  companyShare: string | null;
  isIpTransaction: boolean;
  ipOrganizationId: string | null;
  ipGameId: string | null;
  ipAgreementId: string | null;
  ipSharePct: string | null;
  ipShare: string | null;
  companyRetainedShare: string | null;
  kioskAssignmentId: string | null;
  distributorAgreementId: string | null;
  partnerAgreementId: string | null;
  status: 'RESOLVED' | 'UNRESOLVED';
  unresolvedReason: string | null;
  calculatedAt: Date | null;
}

/**
 * Pure calculation function for a single transaction given preloaded historical context.
 * Exported for comprehensive unit testing and reusability.
 */
export const computeTransactionSplit = (
  tx: {
    id: string;
    kioskId: string;
    gameId: string;
    source: string | null;
    amount: any;
    occurredAt: Date;
  },
  context: {
    gstRate: number;
    pgRate: number;
    kioskAssignments: any[];
    agreements: any[];
    ipProfileBySourceKey: Map<string, any>;
    ipGameMap: Map<string, any>;
    ipAgreements: any[];
  }
): CalculatedSplitPayload => {
  const txDate = tx.occurredAt;
  const txGross = Number(tx.amount);
  const businessDate = getIstBusinessDate(txDate);

  // Validate gross amount
  if (isNaN(txGross) || txGross <= 0) {
    return {
      transactionId: tx.id,
      businessDate,
      grossAmount: String(tx.amount ?? '0'),
      gstAmount: null,
      pgFeeAmount: null,
      netAmount: null,
      distributorShare: null,
      partnerShare: null,
      companyShare: null,
      isIpTransaction: false,
      ipOrganizationId: null,
      ipGameId: null,
      ipAgreementId: null,
      ipSharePct: null,
      ipShare: null,
      companyRetainedShare: null,
      kioskAssignmentId: null,
      distributorAgreementId: null,
      partnerAgreementId: null,
      status: 'UNRESOLVED',
      unresolvedReason: 'Transaction gross amount must be a positive number',
      calculatedAt: null,
    };
  }

  // 1. Calculate Base Deductions (Gross, GST, PG Fee, Net can always be calculated independently)
  const txGst = round2(txGross * context.gstRate);
  const txPgFee = round2(txGross * context.pgRate);
  const txNet = round2(txGross - txGst - txPgFee);

  // Helper to construct an UNRESOLVED payload while preserving independent base deduction calculations
  const buildUnresolved = (
    reason: string,
    isIp: boolean,
    extra: {
      ipOrgId?: string | null;
      ipGameId?: string | null;
      ipAgreementId?: string | null;
      kioskAssignmentId?: string | null;
      distributorAgreementId?: string | null;
      partnerAgreementId?: string | null;
      companyShare?: number | null;
      distributorShare?: number | null;
      partnerShare?: number | null;
    } = {}
  ): CalculatedSplitPayload => ({
    transactionId: tx.id,
    businessDate,
    grossAmount: String(txGross),
    gstAmount: String(txGst),
    pgFeeAmount: String(txPgFee),
    netAmount: String(txNet),
    distributorShare: extra.distributorShare !== undefined && extra.distributorShare !== null ? String(extra.distributorShare) : null,
    partnerShare: extra.partnerShare !== undefined && extra.partnerShare !== null ? String(extra.partnerShare) : null,
    companyShare: extra.companyShare !== undefined && extra.companyShare !== null ? String(extra.companyShare) : null,
    isIpTransaction: isIp,
    ipOrganizationId: extra.ipOrgId ?? null,
    ipGameId: extra.ipGameId ?? null,
    ipAgreementId: extra.ipAgreementId ?? null,
    ipSharePct: null,
    ipShare: null,
    companyRetainedShare: null,
    kioskAssignmentId: extra.kioskAssignmentId ?? null,
    distributorAgreementId: extra.distributorAgreementId ?? null,
    partnerAgreementId: extra.partnerAgreementId ?? null,
    status: 'UNRESOLVED',
    unresolvedReason: reason,
    calculatedAt: null,
  });

  // 2. Resolve Historical Kiosk Assignment at exact millisecond occurredAt
  const matchingAssignments = context.kioskAssignments.filter((a: any) =>
    a.kioskId === tx.kioskId &&
    a.assignedFrom <= txDate &&
    (!a.assignedTo || txDate < a.assignedTo)
  );

  if (matchingAssignments.length === 0) {
    return buildUnresolved(
      `No active kiosk assignment found for kiosk ${tx.kioskId} at occurredAt ${txDate.toISOString()}`,
      false
    );
  }

  if (matchingAssignments.length > 1) {
    return buildUnresolved(
      `Ambiguous overlapping kiosk assignments (${matchingAssignments.length}) found for kiosk ${tx.kioskId} at occurredAt ${txDate.toISOString()}`,
      false
    );
  }

  const assignment = matchingAssignments[0];
  const assignedOrg = assignment.organization;
  let txCompanyShare = 0;
  let txDistShare = 0;
  let txPartnerShare = 0;
  let distributorAgreementId: string | null = null;
  let partnerAgreementId: string | null = null;

  // 3. Resolve Network Agreement Chain (handling ACTIVE and TERMINATED valid agreements)
  if (assignedOrg.type === 'COMPANY') {
    // Machine assigned directly to Company
    txCompanyShare = txNet;
    txDistShare = 0;
    txPartnerShare = 0;
  } else if (assignedOrg.type === 'DISTRIBUTOR') {
    // Case A: Machine assigned to Distributor
    const distAgreements = context.agreements.filter((a: any) =>
      a.parentOrg.type === 'COMPANY' &&
      a.childOrgId === assignedOrg.id &&
      a.effectiveFrom <= txDate &&
      (!a.effectiveTo || txDate < a.effectiveTo)
    );

    if (distAgreements.length === 0) {
      return buildUnresolved(
        `Missing active Company-Distributor agreement for distributor ${assignedOrg.id} at ${txDate.toISOString()}`,
        false,
        { kioskAssignmentId: assignment.id }
      );
    }

    if (distAgreements.length > 1) {
      return buildUnresolved(
        `Ambiguous overlapping Company-Distributor agreements (${distAgreements.length}) found for distributor ${assignedOrg.id} at ${txDate.toISOString()}`,
        false,
        { kioskAssignmentId: assignment.id }
      );
    }

    const distAgreement = distAgreements[0];
    const alpha = Number(distAgreement.parentSharePct) / 100;
    txCompanyShare = round2(txNet * alpha);
    txDistShare = round2(txNet - txCompanyShare);
    txPartnerShare = 0;
    distributorAgreementId = distAgreement.id;
  } else if (assignedOrg.type === 'PARTNER') {
    // Find agreement where Partner is the child
    const partnerAgreements = context.agreements.filter((a: any) =>
      a.childOrgId === assignedOrg.id &&
      a.effectiveFrom <= txDate &&
      (!a.effectiveTo || txDate < a.effectiveTo)
    );

    if (partnerAgreements.length === 0) {
      return buildUnresolved(
        `Missing active agreement for partner ${assignedOrg.id} at ${txDate.toISOString()}`,
        false,
        { kioskAssignmentId: assignment.id }
      );
    }

    if (partnerAgreements.length > 1) {
      return buildUnresolved(
        `Ambiguous overlapping agreements (${partnerAgreements.length}) found for partner ${assignedOrg.id} at ${txDate.toISOString()}`,
        false,
        { kioskAssignmentId: assignment.id }
      );
    }

    const validAgreement = partnerAgreements[0];
    const parentType = validAgreement.parentOrg.type;

    if (parentType === 'COMPANY') {
      // Case B: Company -> Partner
      const alpha = Number(validAgreement.parentSharePct) / 100;
      txCompanyShare = round2(txNet * alpha);
      txPartnerShare = round2(txNet - txCompanyShare);
      txDistShare = 0;
      partnerAgreementId = validAgreement.id;
    } else if (parentType === 'DISTRIBUTOR') {
      // Case C: Company -> Distributor -> Partner
      const distAgreements = context.agreements.filter((a: any) =>
        a.parentOrg.type === 'COMPANY' &&
        a.childOrgId === validAgreement.parentOrgId &&
        a.effectiveFrom <= txDate &&
        (!a.effectiveTo || txDate < a.effectiveTo)
      );

      if (distAgreements.length === 0) {
        return buildUnresolved(
          `Missing active Company-Distributor agreement for distributor ${validAgreement.parentOrgId} at ${txDate.toISOString()}`,
          false,
          {
            kioskAssignmentId: assignment.id,
            partnerAgreementId: validAgreement.id,
          }
        );
      }

      if (distAgreements.length > 1) {
        return buildUnresolved(
          `Ambiguous overlapping Company-Distributor agreements (${distAgreements.length}) found for distributor ${validAgreement.parentOrgId} at ${txDate.toISOString()}`,
          false,
          {
            kioskAssignmentId: assignment.id,
            partnerAgreementId: validAgreement.id,
          }
        );
      }

      const distAgreement = distAgreements[0];
      const alpha = Number(distAgreement.parentSharePct) / 100;
      const beta = Number(validAgreement.parentSharePct) / 100;

      txCompanyShare = round2(txNet * alpha);
      const remainingNetworkShare = round2(txNet - txCompanyShare);
      txDistShare = round2(remainingNetworkShare * beta);
      txPartnerShare = round2(remainingNetworkShare - txDistShare);

      distributorAgreementId = distAgreement.id;
      partnerAgreementId = validAgreement.id;
    } else {
      return buildUnresolved(
        `Unsupported parent organization type '${parentType}' for partner ${assignedOrg.id}`,
        false,
        { kioskAssignmentId: assignment.id }
      );
    }
  } else {
    return buildUnresolved(
      `Unsupported organization type '${assignedOrg.type}' on kiosk assignment`,
      false,
      { kioskAssignmentId: assignment.id }
    );
  }

  // 4. IP Revenue Attribution & Royalty
  const rawSource = tx.source ? tx.source.trim() : null;

  // Non-IP transaction: null source or in-house company game ('nilee-games')
  if (!rawSource || rawSource === 'nilee-games') {
    return {
      transactionId: tx.id,
      businessDate,
      grossAmount: String(txGross),
      gstAmount: String(txGst),
      pgFeeAmount: String(txPgFee),
      netAmount: String(txNet),
      distributorShare: String(txDistShare),
      partnerShare: String(txPartnerShare),
      companyShare: String(txCompanyShare),
      isIpTransaction: false,
      ipOrganizationId: null,
      ipGameId: null,
      ipAgreementId: null,
      ipSharePct: null,
      ipShare: '0.00',
      companyRetainedShare: String(txCompanyShare),
      kioskAssignmentId: assignment.id,
      distributorAgreementId,
      partnerAgreementId,
      status: 'RESOLVED',
      unresolvedReason: null,
      calculatedAt: new Date(),
    };
  }

  // Source provided: check IP registration in IpProfile
  const ipProfile = context.ipProfileBySourceKey.get(rawSource);
  if (!ipProfile) {
    return buildUnresolved(
      `Unknown source '${rawSource}' - not registered in IpProfile`,
      true,
      {
        kioskAssignmentId: assignment.id,
        distributorAgreementId,
        partnerAgreementId,
        companyShare: txCompanyShare,
        distributorShare: txDistShare,
        partnerShare: txPartnerShare,
      }
    );
  }

  const ipOrgId = ipProfile.organizationId;

  // Resolve Registered Game: match normalized gameIdentifier or exact gameId
  const normalizedGameId = normalizeGameIdentifier(tx.gameId);
  const ipGame =
    context.ipGameMap.get(`${ipOrgId}:${normalizedGameId}`) ||
    context.ipGameMap.get(`${ipOrgId}:${tx.gameId}`);
  if (!ipGame) {
    return buildUnresolved(
      `Game '${tx.gameId}' not registered for IP organization ${ipOrgId}`,
      true,
      {
        ipOrgId,
        kioskAssignmentId: assignment.id,
        distributorAgreementId,
        partnerAgreementId,
        companyShare: txCompanyShare,
        distributorShare: txDistShare,
        partnerShare: txPartnerShare,
      }
    );
  }

  // Resolve IP Agreement covering transaction occurredAt (ACTIVE or historical TERMINATED)
  const matchingIpAgreements = context.ipAgreements.filter((a: any) =>
    a.organizationId === ipOrgId &&
    a.effectiveFrom <= txDate &&
    (!a.effectiveTo || txDate < a.effectiveTo)
  );

  if (matchingIpAgreements.length === 0) {
    return buildUnresolved(
      `No active IP agreement found for IP organization ${ipOrgId} at ${txDate.toISOString()}`,
      true,
      {
        ipOrgId,
        ipGameId: ipGame.id,
        kioskAssignmentId: assignment.id,
        distributorAgreementId,
        partnerAgreementId,
        companyShare: txCompanyShare,
        distributorShare: txDistShare,
        partnerShare: txPartnerShare,
      }
    );
  }

  if (matchingIpAgreements.length > 1) {
    return buildUnresolved(
      `Ambiguous overlapping IP agreements (${matchingIpAgreements.length}) found for IP organization ${ipOrgId} at ${txDate.toISOString()}`,
      true,
      {
        ipOrgId,
        ipGameId: ipGame.id,
        kioskAssignmentId: assignment.id,
        distributorAgreementId,
        partnerAgreementId,
        companyShare: txCompanyShare,
        distributorShare: txDistShare,
        partnerShare: txPartnerShare,
      }
    );
  }

  const ipAgreement = matchingIpAgreements[0];

  // 5. Calculate IP Royalty
  const ipSharePctNum = Number(ipAgreement.ipSharePct);
  const txIpShare = round2(txCompanyShare * (ipSharePctNum / 100));
  const txCompanyRetainedShare = round2(txCompanyShare - txIpShare);

  return {
    transactionId: tx.id,
    businessDate,
    grossAmount: String(txGross),
    gstAmount: String(txGst),
    pgFeeAmount: String(txPgFee),
    netAmount: String(txNet),
    distributorShare: String(txDistShare),
    partnerShare: String(txPartnerShare),
    companyShare: String(txCompanyShare),
    isIpTransaction: true,
    ipOrganizationId: ipOrgId,
    ipGameId: ipGame.id,
    ipAgreementId: ipAgreement.id,
    ipSharePct: String(ipSharePctNum),
    ipShare: String(txIpShare),
    companyRetainedShare: String(txCompanyRetainedShare),
    kioskAssignmentId: assignment.id,
    distributorAgreementId,
    partnerAgreementId,
    status: 'RESOLVED',
    unresolvedReason: null,
    calculatedAt: new Date(),
  };
};

/**
 * Finds all transactions lacking a split or with an UNRESOLVED status,
 * preloads historical context, and calculates/persists TransactionSplit records.
 *
 * Implements starvation-free batching: prioritizes brand-new transactions (split: null)
 * first so older unresolved transactions cannot starve newly ingested revenue.
 * Also uses atomic database guards to guarantee idempotency under concurrent worker execution.
 */
export const calculatePendingTransactionSplits = async (
  batchSize: number = 1000,
  maxBatches: number = 10
): Promise<SplitCalculationResult> => {
  console.log('[Split Calculation] Starting pending transaction split calculation...');

  let totalProcessed = 0;
  let resolvedCount = 0;
  let unresolvedCount = 0;
  let failedCount = 0;

  try {
    // Preload SystemSettings once for the run
    const settings = await prisma.systemSettings.findUnique({ where: { id: 'default' } });
    const gstRate = settings ? Number(settings.gstPercentage) / 100 : 0.18;
    const pgRate = settings ? Number(settings.pgFeePercentage) / 100 : 0.025;

    // Preload IP Profiles
    const ipProfiles = await db.ipProfile.findMany({
      select: {
        id: true,
        organizationId: true,
        sourceKey: true,
      },
    });
    const ipProfileBySourceKey = new Map<string, any>(
      ipProfiles.map((p: any) => [p.sourceKey, p])
    );

    // Preload Active Registered IP Games
    const ipGames = await db.ipGame.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        organizationId: true,
        gameIdentifier: true,
        displayName: true,
      },
    });
    const ipGameMap = new Map<string, any>(
      ipGames.map((g: any) => [`${g.organizationId}:${g.gameIdentifier}`, g])
    );

    let batchIteration = 0;

    // Loop through batches to process backlogs while avoiding memory starvation
    while (batchIteration < maxBatches) {
      batchIteration++;

      // 1. Fetch newly ingested transactions without any split first (anti-starvation priority)
      const newTransactions = await db.transaction.findMany({
        where: { split: null },
        select: {
          id: true,
          kioskId: true,
          gameId: true,
          source: true,
          amount: true,
          occurredAt: true,
          split: { select: { id: true, status: true } },
        },
        orderBy: { occurredAt: 'asc' },
        take: batchSize,
      });

      let pendingTransactions = [...newTransactions];

      // If new transactions did not fill the batch, fill the remainder with unresolved retries
      const remainingQuota = batchSize - pendingTransactions.length;
      if (remainingQuota > 0) {
        const retryTransactions = await db.transaction.findMany({
          where: {
            split: { status: { in: ['PENDING', 'UNRESOLVED'] } },
          },
          select: {
            id: true,
            kioskId: true,
            gameId: true,
            source: true,
            amount: true,
            occurredAt: true,
            split: { select: { id: true, status: true } },
          },
          // Round-robin retry ordered by split updatedAt to prevent older stuck records from monopolizing
          orderBy: { split: { updatedAt: 'asc' } },
          take: remainingQuota,
        });

        pendingTransactions = pendingTransactions.concat(retryTransactions);
      }

      if (pendingTransactions.length === 0) {
        if (batchIteration === 1) {
          console.log('[Split Calculation] No pending or unresolved transactions to process.');
        }
        break;
      }

      totalProcessed += pendingTransactions.length;
      console.log(`[Split Calculation] Batch ${batchIteration}: Processing ${pendingTransactions.length} transactions...`);

      // Determine date range & relevant kiosks for preloading context
      let minOccurredAt: Date = pendingTransactions[0].occurredAt;
      let maxOccurredAt: Date = pendingTransactions[0].occurredAt;
      const kioskIdSet = new Set<string>();

      for (const tx of pendingTransactions) {
        if (tx.occurredAt < minOccurredAt) minOccurredAt = tx.occurredAt;
        if (tx.occurredAt > maxOccurredAt) maxOccurredAt = tx.occurredAt;
        kioskIdSet.add(tx.kioskId);
      }

      // Preload KioskAssignments covering the date range for these kiosks
      const kioskAssignments = await prisma.kioskAssignment.findMany({
        where: {
          kioskId: { in: Array.from(kioskIdSet) },
          assignedFrom: { lte: maxOccurredAt },
          OR: [
            { assignedTo: null },
            { assignedTo: { gt: minOccurredAt } },
          ],
        },
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
        },
      });

      // Preload Network Agreements covering the date range (ACTIVE and historical TERMINATED)
      const agreements = await prisma.agreement.findMany({
        where: {
          status: { in: ['ACTIVE', 'TERMINATED'] },
          effectiveFrom: { lte: maxOccurredAt },
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gt: minOccurredAt } },
          ],
        },
        include: {
          parentOrg: { select: { id: true, type: true } },
          childOrg: { select: { id: true, type: true } },
        },
      });

      // Preload IP Agreements covering the date range (ACTIVE and historical TERMINATED)
      const ipAgreements = await db.ipAgreement.findMany({
        where: {
          status: { in: ['ACTIVE', 'TERMINATED'] },
          effectiveFrom: { lte: maxOccurredAt },
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gt: minOccurredAt } },
          ],
        },
        select: {
          id: true,
          organizationId: true,
          ipSharePct: true,
          companySharePct: true,
          effectiveFrom: true,
          effectiveTo: true,
          status: true,
        },
      });

      const context = {
        gstRate,
        pgRate,
        kioskAssignments,
        agreements,
        ipProfileBySourceKey,
        ipGameMap,
        ipAgreements,
      };

      // Process each transaction individually
      for (const tx of pendingTransactions) {
        try {
          const splitPayload = computeTransactionSplit(tx, context);

          if (splitPayload.status === 'RESOLVED') {
            resolvedCount++;
          } else {
            unresolvedCount++;
            console.warn(`[Split Calculation] Unresolved transaction ${tx.id}: ${splitPayload.unresolvedReason}`);
          }

          // Persist split with database-enforced concurrency protection
          if (tx.split) {
            // Atomic update guard: only update if the current status in DB is NOT RESOLVED.
            // If another concurrent worker already marked it RESOLVED, updateMany will safely update 0 rows.
            await db.transactionSplit.updateMany({
              where: {
                id: tx.split.id,
                status: { not: 'RESOLVED' },
              },
              data: {
                businessDate: splitPayload.businessDate,
                grossAmount: splitPayload.grossAmount,
                gstAmount: splitPayload.gstAmount,
                pgFeeAmount: splitPayload.pgFeeAmount,
                netAmount: splitPayload.netAmount,
                distributorShare: splitPayload.distributorShare,
                partnerShare: splitPayload.partnerShare,
                companyShare: splitPayload.companyShare,
                isIpTransaction: splitPayload.isIpTransaction,
                ipOrganizationId: splitPayload.ipOrganizationId,
                ipGameId: splitPayload.ipGameId,
                ipAgreementId: splitPayload.ipAgreementId,
                ipSharePct: splitPayload.ipSharePct,
                ipShare: splitPayload.ipShare,
                companyRetainedShare: splitPayload.companyRetainedShare,
                kioskAssignmentId: splitPayload.kioskAssignmentId,
                distributorAgreementId: splitPayload.distributorAgreementId,
                partnerAgreementId: splitPayload.partnerAgreementId,
                status: splitPayload.status,
                unresolvedReason: splitPayload.unresolvedReason,
                calculatedAt: splitPayload.calculatedAt,
              },
            });
          } else {
            try {
              await db.transactionSplit.create({
                data: {
                  transactionId: splitPayload.transactionId,
                  businessDate: splitPayload.businessDate,
                  grossAmount: splitPayload.grossAmount,
                  gstAmount: splitPayload.gstAmount,
                  pgFeeAmount: splitPayload.pgFeeAmount,
                  netAmount: splitPayload.netAmount,
                  distributorShare: splitPayload.distributorShare,
                  partnerShare: splitPayload.partnerShare,
                  companyShare: splitPayload.companyShare,
                  isIpTransaction: splitPayload.isIpTransaction,
                  ipOrganizationId: splitPayload.ipOrganizationId,
                  ipGameId: splitPayload.ipGameId,
                  ipAgreementId: splitPayload.ipAgreementId,
                  ipSharePct: splitPayload.ipSharePct,
                  ipShare: splitPayload.ipShare,
                  companyRetainedShare: splitPayload.companyRetainedShare,
                  kioskAssignmentId: splitPayload.kioskAssignmentId,
                  distributorAgreementId: splitPayload.distributorAgreementId,
                  partnerAgreementId: splitPayload.partnerAgreementId,
                  status: splitPayload.status,
                  unresolvedReason: splitPayload.unresolvedReason,
                  calculatedAt: splitPayload.calculatedAt,
                },
              });
            } catch (createError: any) {
              if (createError.code === 'P2002') {
                // Another concurrent worker inserted this split between our find and create.
                // Apply atomic update if still un-resolved.
                await db.transactionSplit.updateMany({
                  where: {
                    transactionId: splitPayload.transactionId,
                    status: { not: 'RESOLVED' },
                  },
                  data: {
                    businessDate: splitPayload.businessDate,
                    grossAmount: splitPayload.grossAmount,
                    gstAmount: splitPayload.gstAmount,
                    pgFeeAmount: splitPayload.pgFeeAmount,
                    netAmount: splitPayload.netAmount,
                    distributorShare: splitPayload.distributorShare,
                    partnerShare: splitPayload.partnerShare,
                    companyShare: splitPayload.companyShare,
                    isIpTransaction: splitPayload.isIpTransaction,
                    ipOrganizationId: splitPayload.ipOrganizationId,
                    ipGameId: splitPayload.ipGameId,
                    ipAgreementId: splitPayload.ipAgreementId,
                    ipSharePct: splitPayload.ipSharePct,
                    ipShare: splitPayload.ipShare,
                    companyRetainedShare: splitPayload.companyRetainedShare,
                    kioskAssignmentId: splitPayload.kioskAssignmentId,
                    distributorAgreementId: splitPayload.distributorAgreementId,
                    partnerAgreementId: splitPayload.partnerAgreementId,
                    status: splitPayload.status,
                    unresolvedReason: splitPayload.unresolvedReason,
                    calculatedAt: splitPayload.calculatedAt,
                  },
                });
              } else {
                throw createError;
              }
            }
          }
        } catch (recordError: any) {
          failedCount++;
          console.error(`[Split Calculation] Error processing transaction ${tx.id}:`, recordError);
        }
      }

      // If the processed batch was smaller than the batch size, no more pending records exist
      if (pendingTransactions.length < batchSize) {
        break;
      }
    }

    console.log(
      `[Split Calculation] Completed. Processed: ${totalProcessed}, Resolved: ${resolvedCount}, Unresolved: ${unresolvedCount}, Failed: ${failedCount}`
    );

    return { totalProcessed, resolvedCount, unresolvedCount, failedCount };
  } catch (fatalError: any) {
    console.error('[Split Calculation] Fatal Error:', fatalError);
    throw new ApiError(500, `Fatal error during split calculation: ${fatalError.message || String(fatalError)}`);
  }
};
